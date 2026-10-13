package main

import (
	"os"
	"path/filepath"
	"testing"
)

func Test_normaliseJSON_sortsKeysAndKeepsNumbers(t *testing.T) {
	got, err := normaliseJSON([]byte(`{"b":1.50,"a":[3,1],"c":"<x>"}`))
	if err != nil {
		t.Fatal(err)
	}
	want := "{\n  \"a\": [\n    3,\n    1\n  ],\n  \"b\": 1.50,\n  \"c\": \"<x>\"\n}\n"
	if string(got) != want {
		t.Errorf("got\n%s\nwant\n%s", got, want)
	}
}

func Test_normaliseJSON_rejectsInvalidJSON(t *testing.T) {
	if _, err := normaliseJSON([]byte(`{`)); err == nil {
		t.Fatal("expected error")
	}
}

func Test_hashDirectory(t *testing.T) {
	write := func(t *testing.T, dir, name, content string) {
		t.Helper()
		path := filepath.Join(dir, name)
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	hash := func(t *testing.T, dir string) string {
		t.Helper()
		got, err := hashDirectory(dir)
		if err != nil {
			t.Fatal(err)
		}
		return got
	}

	first, second, renamed, edited := t.TempDir(), t.TempDir(), t.TempDir(), t.TempDir()
	write(t, first, "registry/compact/weaver.yaml", "filter")
	write(t, second, "registry/compact/weaver.yaml", "filter")
	write(t, renamed, "registry/other/weaver.yaml", "filter")
	write(t, edited, "registry/compact/weaver.yaml", "filter2")

	if hash(t, first) != hash(t, second) {
		t.Error("identical trees hash differently")
	}
	if hash(t, first) == hash(t, renamed) {
		t.Error("renamed file did not change the hash")
	}
	if hash(t, first) == hash(t, edited) {
		t.Error("edited file did not change the hash")
	}
}
