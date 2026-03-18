package semantic

import (
	"encoding/json"
	"testing"
)

// TestSemanticMapJSONRoundTrip_ThreeRegions tests AC#1:
// A SemanticMap with 3 top-level regions serializes to JSON and deserializes back identically.
func TestSemanticMapJSONRoundTrip_ThreeRegions(t *testing.T) {
	original := SemanticMap{
		ProjectID:   "proj-1",
		ProjectRoot: "/home/user/myproject",
		RootZoom: SemanticZoomLevel{
			Path:  "",
			Depth: 0,
			Regions: []SemanticRegion{
				{
					ID:          "region-auth",
					Name:        "Authentication System",
					Summary:     "Handles user login, sessions, and JWT tokens",
					Modules:     []string{"mod-auth-handler", "mod-jwt-util"},
					Directories: []string{"src/auth"},
					RegionHash:  "abc123",
				},
				{
					ID:          "region-api",
					Name:        "API Layer",
					Summary:     "REST endpoints and middleware",
					Modules:     []string{"mod-routes", "mod-middleware"},
					Directories: []string{"src/api"},
					RegionHash:  "def456",
				},
				{
					ID:          "region-db",
					Name:        "Database Layer",
					Summary:     "Data access and migrations",
					Modules:     []string{"mod-models", "mod-migrations"},
					Directories: []string{"src/db"},
					RegionHash:  "ghi789",
				},
			},
			Relationships: []SemanticRelationship{
				{
					Source:      "region-api",
					Target:      "region-auth",
					Kind:        RelationshipDependsOn,
					EdgeCount:   5,
					Description: "API endpoints call auth middleware",
				},
				{
					Source:    "region-api",
					Target:    "region-db",
					Kind:      RelationshipDataFlow,
					EdgeCount: 12,
				},
			},
			SourceHash:  "sourcehash-root",
			GeneratedAt: "2026-03-18T00:00:00Z",
		},
		GeneratedAt: "2026-03-18T00:00:00Z",
	}

	data, err := json.Marshal(original)
	if err != nil {
		t.Fatalf("failed to marshal SemanticMap: %v", err)
	}

	var restored SemanticMap
	if err := json.Unmarshal(data, &restored); err != nil {
		t.Fatalf("failed to unmarshal SemanticMap: %v", err)
	}

	// Verify top-level fields
	if restored.ProjectID != original.ProjectID {
		t.Errorf("ProjectID: got %q, want %q", restored.ProjectID, original.ProjectID)
	}
	if restored.ProjectRoot != original.ProjectRoot {
		t.Errorf("ProjectRoot: got %q, want %q", restored.ProjectRoot, original.ProjectRoot)
	}
	if restored.GeneratedAt != original.GeneratedAt {
		t.Errorf("GeneratedAt: got %q, want %q", restored.GeneratedAt, original.GeneratedAt)
	}

	// Verify regions count
	if len(restored.RootZoom.Regions) != 3 {
		t.Fatalf("expected 3 regions, got %d", len(restored.RootZoom.Regions))
	}

	// Verify each region
	for i, want := range original.RootZoom.Regions {
		got := restored.RootZoom.Regions[i]
		if got.ID != want.ID {
			t.Errorf("region[%d].ID: got %q, want %q", i, got.ID, want.ID)
		}
		if got.Name != want.Name {
			t.Errorf("region[%d].Name: got %q, want %q", i, got.Name, want.Name)
		}
		if got.Summary != want.Summary {
			t.Errorf("region[%d].Summary: got %q, want %q", i, got.Summary, want.Summary)
		}
		if got.RegionHash != want.RegionHash {
			t.Errorf("region[%d].RegionHash: got %q, want %q", i, got.RegionHash, want.RegionHash)
		}
	}

	// Verify relationships
	if len(restored.RootZoom.Relationships) != 2 {
		t.Fatalf("expected 2 relationships, got %d", len(restored.RootZoom.Relationships))
	}
	if restored.RootZoom.Relationships[0].Kind != RelationshipDependsOn {
		t.Errorf("relationship[0].Kind: got %q, want %q", restored.RootZoom.Relationships[0].Kind, RelationshipDependsOn)
	}

	// Full deep equality via re-serialization
	data2, _ := json.Marshal(restored)
	if string(data) != string(data2) {
		t.Error("round-trip JSON output differs from original")
	}
}

// TestSemanticMapJSONRoundTrip_NestedChildZoom tests nested zoom levels (3 deep).
func TestSemanticMapJSONRoundTrip_NestedChildZoom(t *testing.T) {
	original := SemanticMap{
		ProjectID:   "proj-nested",
		ProjectRoot: "/project",
		RootZoom: SemanticZoomLevel{
			Path:  "",
			Depth: 0,
			Regions: []SemanticRegion{
				{
					ID:          "top",
					Name:        "Top",
					Summary:     "Top level",
					Modules:     []string{},
					Directories: []string{"src/"},
					RegionHash:  "hash-top",
					ChildZoom: &SemanticZoomLevel{
						Path:  "src/",
						Depth: 1,
						Regions: []SemanticRegion{
							{
								ID:          "mid",
								Name:        "Mid",
								Summary:     "Mid level",
								Modules:     []string{"mod-a"},
								Directories: []string{"src/a"},
								RegionHash:  "hash-mid",
								ChildZoom: &SemanticZoomLevel{
									Path:  "src/a/",
									Depth: 2,
									Regions: []SemanticRegion{
										{
											ID:          "leaf",
											Name:        "Leaf",
											Summary:     "Leaf detail",
											Modules:     []string{"mod-a1", "mod-a2"},
											Directories: []string{"src/a/detail"},
											RegionHash:  "hash-leaf",
										},
									},
									Relationships: []SemanticRelationship{},
									SourceHash:    "src-hash-2",
									GeneratedAt:   "2026-03-18T00:00:00Z",
								},
							},
						},
						Relationships: []SemanticRelationship{},
						SourceHash:    "src-hash-1",
						GeneratedAt:   "2026-03-18T00:00:00Z",
					},
				},
			},
			Relationships: []SemanticRelationship{},
			SourceHash:    "src-hash-0",
			GeneratedAt:   "2026-03-18T00:00:00Z",
		},
		GeneratedAt: "2026-03-18T00:00:00Z",
	}

	data, err := json.Marshal(original)
	if err != nil {
		t.Fatalf("failed to marshal: %v", err)
	}

	var restored SemanticMap
	if err := json.Unmarshal(data, &restored); err != nil {
		t.Fatalf("failed to unmarshal: %v", err)
	}

	// Verify 3 levels of nesting
	if restored.RootZoom.Regions[0].ChildZoom == nil {
		t.Fatal("depth 1 childZoom is nil")
	}
	if restored.RootZoom.Regions[0].ChildZoom.Regions[0].ChildZoom == nil {
		t.Fatal("depth 2 childZoom is nil")
	}
	leaf := restored.RootZoom.Regions[0].ChildZoom.Regions[0].ChildZoom.Regions[0]
	if leaf.ID != "leaf" {
		t.Errorf("leaf region ID: got %q, want %q", leaf.ID, "leaf")
	}
	if leaf.ChildZoom != nil {
		t.Error("leaf childZoom should be nil")
	}
}

// TestSemanticMapJSONRoundTrip_Empty tests AC#10:
// Empty SemanticMap (0 regions) serializes correctly.
func TestSemanticMapJSONRoundTrip_Empty(t *testing.T) {
	original := SemanticMap{
		ProjectID:   "proj-empty",
		ProjectRoot: "/empty",
		RootZoom: SemanticZoomLevel{
			Path:          "",
			Depth:         0,
			Regions:       []SemanticRegion{},
			Relationships: []SemanticRelationship{},
			SourceHash:    "empty-hash",
			GeneratedAt:   "2026-03-18T00:00:00Z",
		},
		GeneratedAt: "2026-03-18T00:00:00Z",
	}

	data, err := json.Marshal(original)
	if err != nil {
		t.Fatalf("failed to marshal empty map: %v", err)
	}

	var restored SemanticMap
	if err := json.Unmarshal(data, &restored); err != nil {
		t.Fatalf("failed to unmarshal empty map: %v", err)
	}

	if len(restored.RootZoom.Regions) != 0 {
		t.Errorf("expected 0 regions, got %d", len(restored.RootZoom.Regions))
	}
	if len(restored.RootZoom.Relationships) != 0 {
		t.Errorf("expected 0 relationships, got %d", len(restored.RootZoom.Relationships))
	}
}

// TestSemanticMapJSONRoundTrip_Unicode verifies unicode in names/summaries survives round-trip.
func TestSemanticMapJSONRoundTrip_Unicode(t *testing.T) {
	original := SemanticMap{
		ProjectID:   "proj-unicode",
		ProjectRoot: "/unicode",
		RootZoom: SemanticZoomLevel{
			Path:  "",
			Depth: 0,
			Regions: []SemanticRegion{
				{
					ID:          "region-intl",
					Name:        "国际化 Internationalization",
					Summary:     "Handles i18n: 日本語、中文、العربية",
					Modules:     []string{"mod-i18n"},
					Directories: []string{"src/i18n"},
					RegionHash:  "unicode-hash",
				},
			},
			Relationships: []SemanticRelationship{},
			SourceHash:    "src-unicode",
			GeneratedAt:   "2026-03-18T00:00:00Z",
		},
		GeneratedAt: "2026-03-18T00:00:00Z",
	}

	data, err := json.Marshal(original)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}

	var restored SemanticMap
	if err := json.Unmarshal(data, &restored); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	got := restored.RootZoom.Regions[0]
	if got.Name != "国际化 Internationalization" {
		t.Errorf("Name: got %q", got.Name)
	}
	if got.Summary != "Handles i18n: 日本語、中文、العربية" {
		t.Errorf("Summary: got %q", got.Summary)
	}
}

// TestRelationshipKindValues verifies the relationship kind constants.
func TestRelationshipKindValues(t *testing.T) {
	kinds := []RelationshipKind{
		RelationshipDependsOn,
		RelationshipDataFlow,
		RelationshipExtends,
		RelationshipUses,
	}

	expected := []string{"depends-on", "data-flow", "extends", "uses"}
	for i, k := range kinds {
		if string(k) != expected[i] {
			t.Errorf("kind[%d]: got %q, want %q", i, string(k), expected[i])
		}
	}
}

// TestChildZoomStartsNil tests that childZoom is nullable and starts nil.
func TestChildZoomStartsNil(t *testing.T) {
	r := SemanticRegion{
		ID:          "r1",
		Name:        "Test",
		Summary:     "Test region",
		Modules:     []string{},
		Directories: []string{},
		RegionHash:  "hash",
	}

	if r.ChildZoom != nil {
		t.Error("childZoom should be nil by default")
	}

	// After setting, should serialize/deserialize
	r.ChildZoom = &SemanticZoomLevel{
		Path:          "sub/",
		Depth:         1,
		Regions:       []SemanticRegion{},
		Relationships: []SemanticRelationship{},
		SourceHash:    "sub-hash",
		GeneratedAt:   "2026-03-18T00:00:00Z",
	}

	data, err := json.Marshal(r)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}

	var restored SemanticRegion
	if err := json.Unmarshal(data, &restored); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	if restored.ChildZoom == nil {
		t.Fatal("childZoom should not be nil after setting")
	}
	if restored.ChildZoom.Path != "sub/" {
		t.Errorf("childZoom.Path: got %q", restored.ChildZoom.Path)
	}
}

// TestMultiLevelZoomModel tests AC#9:
// The model supports 3+ zoom levels: depth 0 → depth 1 → depth 2.
func TestMultiLevelZoomModel(t *testing.T) {
	// Depth 0: 4 regions covering entire project
	depth0 := SemanticZoomLevel{
		Path:  "",
		Depth: 0,
		Regions: []SemanticRegion{
			{ID: "r0-auth", Name: "Auth", Summary: "Auth system", Modules: []string{"mod-auth"}, Directories: []string{"src/auth"}, RegionHash: "h0-1"},
			{ID: "r0-api", Name: "API", Summary: "API layer", Modules: []string{"mod-api"}, Directories: []string{"src/api"}, RegionHash: "h0-2"},
			{ID: "r0-db", Name: "DB", Summary: "Database", Modules: []string{"mod-db"}, Directories: []string{"src/db"}, RegionHash: "h0-3"},
			{ID: "r0-ui", Name: "UI", Summary: "Frontend", Modules: []string{"mod-ui"}, Directories: []string{"src/ui"}, RegionHash: "h0-4"},
		},
		Relationships: []SemanticRelationship{},
		SourceHash:    "src-0",
		GeneratedAt:   "2026-03-18T00:00:00Z",
	}

	if len(depth0.Regions) != 4 {
		t.Fatalf("depth 0: expected 4 regions, got %d", len(depth0.Regions))
	}
	if depth0.Depth != 0 {
		t.Errorf("depth 0: got depth %d", depth0.Depth)
	}

	// Depth 1: expand auth region to 5 sub-regions
	depth1 := SemanticZoomLevel{
		Path:  "src/auth",
		Depth: 1,
		Regions: []SemanticRegion{
			{ID: "r1-login", Name: "Login", Summary: "Login flow", Modules: []string{"mod-login"}, Directories: []string{"src/auth/login"}, RegionHash: "h1-1"},
			{ID: "r1-jwt", Name: "JWT", Summary: "Token handling", Modules: []string{"mod-jwt"}, Directories: []string{"src/auth/jwt"}, RegionHash: "h1-2"},
			{ID: "r1-session", Name: "Sessions", Summary: "Session mgmt", Modules: []string{"mod-session"}, Directories: []string{"src/auth/session"}, RegionHash: "h1-3"},
			{ID: "r1-oauth", Name: "OAuth", Summary: "OAuth providers", Modules: []string{"mod-oauth"}, Directories: []string{"src/auth/oauth"}, RegionHash: "h1-4"},
			{ID: "r1-rbac", Name: "RBAC", Summary: "Role-based access", Modules: []string{"mod-rbac"}, Directories: []string{"src/auth/rbac"}, RegionHash: "h1-5"},
		},
		Relationships: []SemanticRelationship{},
		SourceHash:    "src-1",
		GeneratedAt:   "2026-03-18T00:00:00Z",
	}
	depth0.Regions[0].ChildZoom = &depth1

	if len(depth1.Regions) != 5 {
		t.Fatalf("depth 1: expected 5 regions, got %d", len(depth1.Regions))
	}

	// Depth 2: expand login sub-region
	depth2 := SemanticZoomLevel{
		Path:  "src/auth/login",
		Depth: 2,
		Regions: []SemanticRegion{
			{ID: "r2-handler", Name: "Login Handler", Summary: "HTTP handler", Modules: []string{"mod-login-handler"}, Directories: []string{"src/auth/login"}, RegionHash: "h2-1"},
			{ID: "r2-validator", Name: "Input Validator", Summary: "Validates credentials", Modules: []string{"mod-login-validator"}, Directories: []string{"src/auth/login"}, RegionHash: "h2-2"},
		},
		Relationships: []SemanticRelationship{},
		SourceHash:    "src-2",
		GeneratedAt:   "2026-03-18T00:00:00Z",
	}
	depth1.Regions[0].ChildZoom = &depth2
	// Update the parent's reference
	depth0.Regions[0].ChildZoom = &depth1

	// Verify navigation: depth0 → depth1 → depth2
	if depth0.Regions[0].ChildZoom == nil {
		t.Fatal("depth0→depth1 link is nil")
	}
	if depth0.Regions[0].ChildZoom.Regions[0].ChildZoom == nil {
		t.Fatal("depth1→depth2 link is nil")
	}
	if depth0.Regions[0].ChildZoom.Regions[0].ChildZoom.Depth != 2 {
		t.Errorf("expected depth 2, got %d", depth0.Regions[0].ChildZoom.Regions[0].ChildZoom.Depth)
	}

	// Regions at different depths reference correct module IDs
	if depth0.Regions[0].Modules[0] != "mod-auth" {
		t.Errorf("depth 0 module ref wrong")
	}
	if depth1.Regions[0].Modules[0] != "mod-login" {
		t.Errorf("depth 1 module ref wrong")
	}
	if depth2.Regions[0].Modules[0] != "mod-login-handler" {
		t.Errorf("depth 2 module ref wrong")
	}
}
