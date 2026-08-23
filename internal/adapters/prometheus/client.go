package prometheus

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/claudioed/polaris/internal/domain/fitness"
)

var (
	ErrNoData          = errors.New("prometheus query returned no data")
	ErrAmbiguousResult = errors.New("prometheus query returned ambiguous series")
)

type Client struct {
	httpClient *http.Client
	maxBytes   int64
}

func New(httpClient *http.Client, maxBytes int64) *Client {
	if httpClient == nil {
		httpClient = http.DefaultClient
	}
	if maxBytes < 1 {
		maxBytes = 4 << 20
	}
	return &Client{httpClient: httpClient, maxBytes: maxBytes}
}

func (c *Client) Check(ctx context.Context, baseURL string) error {
	endpoint, err := resolve(baseURL, "/-/ready")
	if err != nil {
		return err
	}
	request, _ := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	response, err := c.httpClient.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode/100 != 2 {
		return fmt.Errorf("prometheus readiness returned HTTP %d", response.StatusCode)
	}
	return nil
}

func (c *Client) Query(ctx context.Context, baseURL string, query fitness.MetricQuery, at time.Time, timeout time.Duration) (float64, map[string]any, error) {
	path := "/api/v1/query"
	values := url.Values{"query": {query.Expression}, "time": {at.Format(time.RFC3339Nano)}, "timeout": {timeout.String()}}
	if query.Mode == "RANGE" {
		path = "/api/v1/query_range"
		values.Set("start", at.Add(-time.Duration(query.LookbackSecond)*time.Second).Format(time.RFC3339Nano))
		values.Set("end", at.Format(time.RFC3339Nano))
		values.Set("step", strconv.Itoa(query.StepSecond))
	}
	endpoint, err := resolve(baseURL, path)
	if err != nil {
		return 0, nil, err
	}
	queryCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	request, _ := http.NewRequestWithContext(queryCtx, http.MethodPost, endpoint, strings.NewReader(values.Encode()))
	request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	response, err := c.httpClient.Do(request)
	if err != nil {
		return 0, nil, err
	}
	defer response.Body.Close()
	if response.StatusCode/100 != 2 {
		return 0, nil, fmt.Errorf("prometheus query returned HTTP %d", response.StatusCode)
	}
	raw, err := io.ReadAll(io.LimitReader(response.Body, c.maxBytes+1))
	if err != nil {
		return 0, nil, err
	}
	if int64(len(raw)) > c.maxBytes {
		return 0, nil, errors.New("prometheus response exceeds configured limit")
	}
	var envelope apiResponse
	if err = json.Unmarshal(raw, &envelope); err != nil {
		return 0, nil, fmt.Errorf("decode prometheus response: %w", err)
	}
	if envelope.Status != "success" {
		return 0, nil, fmt.Errorf("prometheus query failed: %s", envelope.Error)
	}
	series, err := samples(envelope.Data)
	if err != nil {
		return 0, nil, err
	}
	if len(series) == 0 {
		return 0, nil, ErrNoData
	}
	if len(series) > 1 && query.SeriesPolicy != "REDUCE_ACROSS_SERIES" {
		return 0, nil, ErrAmbiguousResult
	}
	var flattened []float64
	for _, values := range series {
		flattened = append(flattened, values...)
	}
	value, err := reduce(flattened, query.Reduction)
	if err != nil {
		return 0, nil, err
	}
	return value, map[string]any{
		"providerType": "PROMETHEUS", "queryFingerprint": fingerprint(query.Expression),
		"resultType": envelope.Data.ResultType, "seriesCount": len(series), "sampleCount": len(flattened),
		"queriedAt": at,
	}, nil
}

type apiResponse struct {
	Status string `json:"status"`
	Error  string `json:"error"`
	Data   struct {
		ResultType string          `json:"resultType"`
		Result     json.RawMessage `json:"result"`
	} `json:"data"`
}

func samples(data struct {
	ResultType string          `json:"resultType"`
	Result     json.RawMessage `json:"result"`
}) ([][]float64, error) {
	switch data.ResultType {
	case "scalar":
		var pair []json.RawMessage
		if err := json.Unmarshal(data.Result, &pair); err != nil || len(pair) != 2 {
			return nil, errors.New("invalid prometheus scalar")
		}
		value, err := parseSample(pair[1])
		return [][]float64{{value}}, err
	case "vector":
		var result []struct {
			Value []json.RawMessage `json:"value"`
		}
		if err := json.Unmarshal(data.Result, &result); err != nil {
			return nil, err
		}
		output := make([][]float64, 0, len(result))
		for _, item := range result {
			if len(item.Value) != 2 {
				return nil, errors.New("invalid prometheus vector sample")
			}
			value, err := parseSample(item.Value[1])
			if err != nil {
				return nil, err
			}
			output = append(output, []float64{value})
		}
		return output, nil
	case "matrix":
		var result []struct {
			Values [][]json.RawMessage `json:"values"`
		}
		if err := json.Unmarshal(data.Result, &result); err != nil {
			return nil, err
		}
		output := make([][]float64, 0, len(result))
		for _, item := range result {
			var values []float64
			for _, pair := range item.Values {
				if len(pair) != 2 {
					return nil, errors.New("invalid prometheus matrix sample")
				}
				value, err := parseSample(pair[1])
				if err != nil {
					return nil, err
				}
				values = append(values, value)
			}
			if len(values) > 0 {
				output = append(output, values)
			}
		}
		return output, nil
	default:
		return nil, fmt.Errorf("unsupported prometheus result type %q", data.ResultType)
	}
}

func parseSample(raw json.RawMessage) (float64, error) {
	var text string
	if err := json.Unmarshal(raw, &text); err != nil {
		return 0, errors.New("prometheus sample is not a string")
	}
	value, err := strconv.ParseFloat(text, 64)
	if err != nil || math.IsNaN(value) || math.IsInf(value, 0) {
		return 0, errors.New("prometheus sample is not finite")
	}
	return value, nil
}

func reduce(values []float64, operation string) (float64, error) {
	if len(values) == 0 {
		return 0, ErrNoData
	}
	switch operation {
	case "LAST":
		return values[len(values)-1], nil
	case "COUNT":
		return float64(len(values)), nil
	}
	value := values[0]
	switch operation {
	case "MIN":
		for _, candidate := range values[1:] {
			if candidate < value {
				value = candidate
			}
		}
	case "MAX":
		for _, candidate := range values[1:] {
			if candidate > value {
				value = candidate
			}
		}
	case "SUM", "AVERAGE":
		for _, candidate := range values[1:] {
			value += candidate
		}
		if operation == "AVERAGE" {
			value /= float64(len(values))
		}
	default:
		return 0, fmt.Errorf("unsupported reduction %q", operation)
	}
	return value, nil
}

func resolve(baseURL, path string) (string, error) {
	parsed, err := url.Parse(baseURL)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return "", errors.New("invalid prometheus base URL")
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return "", errors.New("unsupported prometheus URL scheme")
	}
	parsed.Path = strings.TrimRight(parsed.Path, "/") + path
	parsed.RawQuery = ""
	parsed.Fragment = ""
	return parsed.String(), nil
}

func fingerprint(value string) string {
	var hash uint64 = 1469598103934665603
	for i := 0; i < len(value); i++ {
		hash ^= uint64(value[i])
		hash *= 1099511628211
	}
	return fmt.Sprintf("fnv64:%016x", hash)
}
