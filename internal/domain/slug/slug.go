// Package slug derives and validates the human-readable alternate identifier
// used by Tribe, Squad, and FitnessFunction (see adr/0001-human-readable-slugs.md).
// It knows nothing about persistence or scope: callers are responsible for
// uniqueness (enforced by a database constraint) and for deciding which kinds
// get a slug at all.
package slug

import (
	"errors"
	"fmt"
	"strings"
)

// ErrInvalid reports a slug that is empty, too long, or does not match the
// required format.
var ErrInvalid = errors.New("invalid slug")

// MaxLength is a DNS-label-safe cap: slugs may end up in a URL path, a
// subdomain, or a Kubernetes label.
const MaxLength = 63

// Generate derives a best-effort slug from name: lowercase ASCII letters and
// digits are kept, every other rune (including non-ASCII letters -- there is
// no Unicode folding here) collapses a run of separators into a single
// hyphen, and leading/trailing hyphens are trimmed. The result is truncated
// to MaxLength, trimming any hyphen exposed by the cut. It may be empty when
// name has no ASCII alphanumerics; callers must treat that as "no default
// available" (see Resolve) rather than inserting an empty slug.
func Generate(name string) string {
	var b strings.Builder
	pendingHyphen := false
	for _, r := range strings.ToLower(name) {
		switch {
		case r >= 'a' && r <= 'z' || r >= '0' && r <= '9':
			b.WriteRune(r)
			pendingHyphen = false
		case !pendingHyphen && b.Len() > 0:
			b.WriteByte('-')
			pendingHyphen = true
		}
	}
	s := strings.TrimRight(b.String(), "-")
	if len(s) > MaxLength {
		s = strings.TrimRight(s[:MaxLength], "-")
	}
	return s
}

// Validate reports whether s is a well-formed slug: one or more lowercase
// alphanumeric segments joined by single hyphens, 1-MaxLength characters.
func Validate(s string) error {
	if len(s) == 0 || len(s) > MaxLength || !isWellFormed(s) {
		return fmt.Errorf("%w: %q must be 1-%d lowercase alphanumeric segments joined by single hyphens", ErrInvalid, s, MaxLength)
	}
	return nil
}

// Resolve returns explicit, validated, when the caller supplied one, or a
// name-derived default otherwise. It never mutates an explicit value (an
// invalid explicit slug is always an error, never silently corrected) and
// never returns an empty slug (a name with no derivable default is an error
// asking the caller to supply one explicitly).
func Resolve(explicit, name string) (string, error) {
	if explicit != "" {
		if err := Validate(explicit); err != nil {
			return "", err
		}
		return explicit, nil
	}
	derived := Generate(name)
	if derived == "" {
		return "", fmt.Errorf("%w: no slug could be derived from %q; provide one explicitly", ErrInvalid, name)
	}
	return derived, nil
}

func isWellFormed(s string) bool {
	prevHyphen := true // leading hyphen is invalid, so start as if one just occurred
	for i := 0; i < len(s); i++ {
		c := s[i]
		switch {
		case c >= 'a' && c <= 'z' || c >= '0' && c <= '9':
			prevHyphen = false
		case c == '-':
			if prevHyphen {
				return false
			}
			prevHyphen = true
		default:
			return false
		}
	}
	return !prevHyphen // trailing hyphen is invalid
}
