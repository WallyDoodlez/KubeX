"""Knowledge base schemas — Graphiti + OpenSearch parameter models and ontology."""

from __future__ import annotations

import enum
from datetime import datetime

from pydantic import BaseModel, Field


class EntityType(str, enum.Enum):
    """Fixed ontology — 10 entity types."""

    PERSON = "Person"
    ORGANIZATION = "Organization"
    PRODUCT = "Product"
    PLATFORM = "Platform"
    CONCEPT = "Concept"
    EVENT = "Event"
    LOCATION = "Location"
    DOCUMENT = "Document"
    METRIC = "Metric"
    WORKFLOW = "Workflow"


class RelationshipType(str, enum.Enum):
    """Fixed ontology — 12 relationship types."""

    OWNS = "OWNS"
    WORKS_FOR = "WORKS_FOR"
    USES = "USES"
    PRODUCES = "PRODUCES"
    REFERENCES = "REFERENCES"
    RELATES_TO = "RELATES_TO"
    PART_OF = "PART_OF"
    OCCURRED_AT = "OCCURRED_AT"
    MEASURED_BY = "MEASURED_BY"
    PRECEDED_BY = "PRECEDED_BY"
    COMPETES_WITH = "COMPETES_WITH"
    DEPENDS_ON = "DEPENDS_ON"


class KnowledgeQueryParams(BaseModel):
    """Parameters for query_knowledge action."""

    query: str = Field(..., description="Natural language query for the knowledge graph")
    max_results: int = Field(default=10, ge=1, le=100)
    entity_types: list[EntityType] | None = None
    valid_at: datetime | None = Field(default=None, description="Point-in-time query (+-24h window enforced by Gateway)")
    group_id: str = "shared"


class KnowledgeStoreParams(BaseModel):
    """Parameters for store_knowledge action."""

    content: str = Field(..., description="Knowledge content to store")
    source_description: str = Field(..., description="Provenance — where this knowledge came from")
    workflow_id: str | None = None
    task_id: str | None = None
    entity_type_hints: list[EntityType] = Field(default_factory=list)
    group_id: str = "shared"
    valid_at: datetime | None = Field(default=None, description="When this knowledge became true")


class CorpusSearchParams(BaseModel):
    """Parameters for search_corpus action."""

    query: str = Field(..., description="Full-text search query")
    max_results: int = Field(default=10, ge=1, le=100)
    index_pattern: str = "knowledge-corpus-shared-*"
    date_from: datetime | None = None
    date_to: datetime | None = None


class KnowledgeEntity(BaseModel):
    """An entity returned from knowledge graph queries."""

    entity_id: str
    entity_type: EntityType
    name: str
    properties: dict = Field(default_factory=dict)
    source_ids: list[str] = Field(default_factory=list)


class KnowledgeRelation(BaseModel):
    """A relationship between entities."""

    relation_id: str
    relation_type: RelationshipType
    source_entity_id: str
    target_entity_id: str
    properties: dict = Field(default_factory=dict)
    valid_at: datetime | None = None
    invalid_at: datetime | None = None
    source_id: str | None = Field(default=None, description="OpenSearch document ID for provenance")


class KnowledgeQueryResult(BaseModel):
    """Result from a knowledge graph query."""

    entities: list[KnowledgeEntity] = Field(default_factory=list)
    relations: list[KnowledgeRelation] = Field(default_factory=list)
    total_results: int = 0


class CorpusDocument(BaseModel):
    """A document from the OpenSearch corpus."""

    document_id: str
    content: str
    source_description: str = ""
    workflow_id: str | None = None
    task_id: str | None = None
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    score: float = 0.0


class CorpusSearchResult(BaseModel):
    """Result from a corpus search."""

    documents: list[CorpusDocument] = Field(default_factory=list)
    total_results: int = 0
