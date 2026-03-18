package semantic

// RelationshipKind is a string type for relationship classifications.
type RelationshipKind string

const (
	RelationshipDependsOn RelationshipKind = "depends-on"
	RelationshipDataFlow  RelationshipKind = "data-flow"
	RelationshipExtends   RelationshipKind = "extends"
	RelationshipUses      RelationshipKind = "uses"
)

// SemanticMap is the top-level container for a project's semantic zoom data.
type SemanticMap struct {
	ProjectID   string            `json:"projectId"`
	ProjectRoot string            `json:"projectRoot"`
	RootZoom    SemanticZoomLevel `json:"rootZoom"`
	GeneratedAt string            `json:"generatedAt"`
}

// SemanticZoomLevel represents a single zoom level in the semantic hierarchy.
type SemanticZoomLevel struct {
	Path          string                 `json:"path"`
	Depth         int                    `json:"depth"`
	Regions       []SemanticRegion       `json:"regions"`
	Relationships []SemanticRelationship `json:"relationships"`
	SourceHash    string                 `json:"sourceHash"`
	GeneratedAt   string                 `json:"generatedAt"`
}

// SemanticRegion represents a semantic region within a zoom level.
type SemanticRegion struct {
	ID          string             `json:"id"`
	Name        string             `json:"name"`
	Summary     string             `json:"summary"`
	Modules     []string           `json:"modules"`
	Directories []string           `json:"directories"`
	RegionHash  string             `json:"regionHash"`
	ChildZoom   *SemanticZoomLevel `json:"childZoom,omitempty"`
}

// SemanticRelationship represents a relationship between two regions.
type SemanticRelationship struct {
	Source      string           `json:"source"`
	Target      string           `json:"target"`
	Kind        RelationshipKind `json:"kind"`
	EdgeCount   int              `json:"edgeCount"`
	Description string           `json:"description,omitempty"`
}
