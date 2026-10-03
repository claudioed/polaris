package slug

import (
	"errors"
	"strings"
	"testing"
)

func TestGenerate(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want string
	}{
		{"simple", "Checkout", "checkout"},
		{"spaces", "Code Quality", "code-quality"},
		{"punctuation", "Checkout API!! (v2)", "checkout-api-v2"},
		{"already-hyphenated", "code-quality", "code-quality"},
		{"collapses runs of separators", "a   ---   b", "a-b"},
		{"trims leading and trailing separators", "--Commerce--", "commerce"},
		{"empty", "", ""},
		{"all symbols", "!!!", ""},
		{"digits kept", "Release 2026", "release-2026"},
		{"non-ascii letters are dropped, not folded", "café", "caf"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := Generate(c.in); got != c.want {
				t.Fatalf("Generate(%q) = %q, want %q", c.in, got, c.want)
			}
		})
	}
}

func TestGenerateTruncatesAndTrimsExposedHyphen(t *testing.T) {
	// 70 a's -> truncated to 63 a's, no trailing hyphen to trim.
	in := strings.Repeat("a", 70)
	got := Generate(in)
	if len(got) != MaxLength {
		t.Fatalf("len = %d, want %d", len(got), MaxLength)
	}
	if got != strings.Repeat("a", MaxLength) {
		t.Fatalf("got = %q", got)
	}

	// Craft a name whose derived slug has a hyphen landing exactly at the
	// truncation boundary once lowercased/collapsed, so the cut must trim it.
	in = strings.Repeat("a", MaxLength) + " b"
	got = Generate(in)
	if len(got) > MaxLength || strings.HasSuffix(got, "-") {
		t.Fatalf("Generate(%q) = %q, want <=%d chars with no trailing hyphen", in, got, MaxLength)
	}
}

func TestValidate(t *testing.T) {
	valid := []string{"a", "code-quality", "release-2026", "a-b-c", strings.Repeat("a", MaxLength)}
	for _, s := range valid {
		if err := Validate(s); err != nil {
			t.Errorf("Validate(%q) = %v, want nil", s, err)
		}
	}

	invalid := []string{
		"",
		"-leading",
		"trailing-",
		"double--hyphen",
		"Has-Upper",
		"has_underscore",
		"has space",
		strings.Repeat("a", MaxLength+1),
	}
	for _, s := range invalid {
		if err := Validate(s); !errors.Is(err, ErrInvalid) {
			t.Errorf("Validate(%q) = %v, want ErrInvalid", s, err)
		}
	}
}

func TestResolve(t *testing.T) {
	t.Run("uses a valid explicit slug as-is", func(t *testing.T) {
		got, err := Resolve("custom-slug", "Some Name")
		if err != nil || got != "custom-slug" {
			t.Fatalf("Resolve() = %q, %v", got, err)
		}
	})

	t.Run("never corrects an invalid explicit slug", func(t *testing.T) {
		_, err := Resolve("Not Valid!!", "Some Name")
		if !errors.Is(err, ErrInvalid) {
			t.Fatalf("err = %v, want ErrInvalid", err)
		}
	})

	t.Run("derives from name when explicit is empty", func(t *testing.T) {
		got, err := Resolve("", "Code Quality")
		if err != nil || got != "code-quality" {
			t.Fatalf("Resolve() = %q, %v", got, err)
		}
	})

	t.Run("errors when neither explicit nor name yields a slug", func(t *testing.T) {
		_, err := Resolve("", "!!!")
		if !errors.Is(err, ErrInvalid) {
			t.Fatalf("err = %v, want ErrInvalid", err)
		}
	})
}
