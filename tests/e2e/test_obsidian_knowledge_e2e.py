"""E2E Tests: Obsidian Markdown Knowledge Vault.

These tests validate the vault_ops and init_vault modules that back the
``obsidian-vault`` skill.  All tests use ``tmp_path`` — no Docker required.

Test coverage:
  1.  Vault initialization creates expected directory structure
  2.  Vault initialization is idempotent (safe to run twice)
  3.  create_note writes file with correct frontmatter fields
  4.  create_note builds the correct vault-relative path
  5.  create_note raises FileExistsError for duplicate slugs
  6.  create_note raises ValueError for invalid folders
  7.  create_note appends wiki-links in a Related section
  8.  update_note (append mode) adds a dated update heading
  9.  update_note (replace mode) replaces body, preserves frontmatter
  10. update_note updates the modified date in frontmatter
  11. update_note raises FileNotFoundError for missing notes
  12. search_notes finds a note by title keyword
  13. search_notes finds a note by body keyword
  14. search_notes filters by folder
  15. search_notes filters by tag
  16. search_notes requires ALL keywords to match
  17. get_note returns frontmatter and content
  18. get_note raises FileNotFoundError for missing notes
  19. list_notes returns all notes in vault
  20. list_notes filters to a single folder
  21. list_notes excludes .obsidian and template folders
  22. find_backlinks finds notes with [[wiki-link]] to target
  23. find_backlinks finds [[note|display text]] links
  24. find_backlinks returns empty list when no links found
  25. commit_and_push degrades gracefully when no git repo present
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest
import yaml

# ---------------------------------------------------------------------------
# Path setup — allow running from project root or tests/ directory
# ---------------------------------------------------------------------------

_SKILL_TOOLS = Path(__file__).resolve().parents[2] / "skills" / "knowledge" / "obsidian-vault" / "tools"
if str(_SKILL_TOOLS) not in sys.path:
    sys.path.insert(0, str(_SKILL_TOOLS))

from init_vault import init_vault  # noqa: E402
from vault_ops import (  # noqa: E402
    create_note,
    find_backlinks,
    get_note,
    list_notes,
    search_notes,
    update_note,
    commit_and_push,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _read_note(vault_path: Path, rel_path: str) -> str:
    return (vault_path / rel_path).read_text(encoding="utf-8")


def _parse_frontmatter(text: str) -> tuple[dict, str]:
    if not text.startswith("---"):
        return {}, text
    end = text.find("\n---", 3)
    if end == -1:
        return {}, text
    fm = yaml.safe_load(text[3:end].strip()) or {}
    body = text[end + 4:].lstrip("\n")
    return fm, body


# ===========================================================================
# 1-2. Vault initialization
# ===========================================================================


class TestInitVault:
    def test_creates_expected_folders(self, tmp_path):
        """init_vault creates all required vault subdirectories."""
        init_vault(str(tmp_path))
        for folder in ("facts", "entities", "events", "decisions", "logs", "templates"):
            assert (tmp_path / folder).is_dir(), f"Missing folder: {folder}"

    def test_creates_obsidian_config_directory(self, tmp_path):
        """init_vault creates .obsidian/ with app.json and workspace.json."""
        init_vault(str(tmp_path))
        assert (tmp_path / ".obsidian" / "app.json").exists()
        assert (tmp_path / ".obsidian" / "workspace.json").exists()

    def test_obsidian_app_json_enables_wiki_links(self, tmp_path):
        """app.json has useMarkdownLinks=False to enable [[wiki-links]]."""
        import json
        init_vault(str(tmp_path))
        app = json.loads((tmp_path / ".obsidian" / "app.json").read_text())
        assert app["useMarkdownLinks"] is False

    def test_creates_readme(self, tmp_path):
        """init_vault creates a README.md in the vault root."""
        init_vault(str(tmp_path))
        readme = tmp_path / "README.md"
        assert readme.exists()
        content = readme.read_text(encoding="utf-8")
        assert "KubexClaw Knowledge Vault" in content

    def test_creates_templates(self, tmp_path):
        """init_vault creates fact.md, entity.md, event.md templates."""
        init_vault(str(tmp_path))
        for tmpl in ("fact.md", "entity.md", "event.md"):
            assert (tmp_path / "templates" / tmpl).exists()

    def test_idempotent_no_error_on_second_run(self, tmp_path):
        """init_vault can be called twice without error."""
        result1 = init_vault(str(tmp_path))
        result2 = init_vault(str(tmp_path))
        assert isinstance(result1, dict)
        assert isinstance(result2, dict)
        # Second run should skip everything that already exists
        assert len(result2["created"]) == 0
        assert len(result2["skipped"]) > 0

    def test_returns_created_and_skipped_lists(self, tmp_path):
        """init_vault returns dicts with created and skipped lists."""
        result = init_vault(str(tmp_path))
        assert "created" in result
        assert "skipped" in result
        assert isinstance(result["created"], list)
        assert isinstance(result["skipped"], list)


# ===========================================================================
# 3-8. create_note
# ===========================================================================


class TestCreateNote:
    def test_creates_file_in_correct_folder(self, tmp_path):
        """create_note writes the file into the correct subfolder."""
        init_vault(str(tmp_path))
        result = create_note(
            vault_path=str(tmp_path),
            title="OpenAI API Rate Limits",
            content="GPT-4 has 10,000 TPM.",
            folder="facts",
            tags=["api", "openai"],
            today="2026-03-20",
        )
        assert result["created"] is True
        note_path = tmp_path / result["path"]
        assert note_path.exists()
        assert result["path"].startswith("facts/")

    def test_filename_is_slugified(self, tmp_path):
        """create_note slugifies the title into kebab-case."""
        init_vault(str(tmp_path))
        result = create_note(
            vault_path=str(tmp_path),
            title="Nike Instagram Followers Q1 2026",
            content="42 million followers.",
            folder="facts",
            tags=["instagram", "nike"],
            today="2026-03-20",
        )
        assert "nike-instagram-followers-q1-2026" in result["path"]

    def test_frontmatter_contains_required_fields(self, tmp_path):
        """create_note writes all required frontmatter fields."""
        init_vault(str(tmp_path))
        result = create_note(
            vault_path=str(tmp_path),
            title="Test Fact",
            content="Some content.",
            folder="facts",
            tags=["test"],
            today="2026-03-20",
        )
        text = _read_note(tmp_path, result["path"])
        fm, _ = _parse_frontmatter(text)
        assert fm["title"] == "Test Fact"
        assert fm["type"] == "fact"
        assert fm["tags"] == ["test"]
        assert fm["created"] == "2026-03-20"
        assert fm["modified"] == "2026-03-20"

    def test_type_derived_from_folder(self, tmp_path):
        """create_note sets type based on folder when note_type is not given."""
        init_vault(str(tmp_path))
        for folder, expected_type in [
            ("entities", "entity"),
            ("events", "event"),
            ("decisions", "decision"),
            ("logs", "log"),
        ]:
            result = create_note(
                vault_path=str(tmp_path),
                title=f"Test {folder.title()}",
                content="Body.",
                folder=folder,
                tags=["test"],
                today="2026-03-20",
            )
            text = _read_note(tmp_path, result["path"])
            fm, _ = _parse_frontmatter(text)
            assert fm["type"] == expected_type, f"Wrong type for folder {folder}"

    def test_note_type_can_be_overridden(self, tmp_path):
        """create_note respects explicit note_type argument."""
        init_vault(str(tmp_path))
        result = create_note(
            vault_path=str(tmp_path),
            title="Special Note",
            content="Body.",
            folder="facts",
            tags=["test"],
            note_type="decision",
            today="2026-03-20",
        )
        text = _read_note(tmp_path, result["path"])
        fm, _ = _parse_frontmatter(text)
        assert fm["type"] == "decision"

    def test_source_written_to_frontmatter(self, tmp_path):
        """create_note writes the source field when provided."""
        init_vault(str(tmp_path))
        result = create_note(
            vault_path=str(tmp_path),
            title="Sourced Fact",
            content="Body.",
            folder="facts",
            tags=["test"],
            source="task-abc123",
            today="2026-03-20",
        )
        text = _read_note(tmp_path, result["path"])
        fm, _ = _parse_frontmatter(text)
        assert fm["source"] == "task-abc123"

    def test_body_content_present_in_file(self, tmp_path):
        """create_note includes the body content in the written file."""
        init_vault(str(tmp_path))
        result = create_note(
            vault_path=str(tmp_path),
            title="Content Test",
            content="This is the body of the note with specific details.",
            folder="facts",
            tags=["test"],
            today="2026-03-20",
        )
        text = _read_note(tmp_path, result["path"])
        assert "This is the body of the note with specific details." in text

    def test_creates_related_section_with_links(self, tmp_path):
        """create_note appends a ## Related section with [[wiki-links]]."""
        init_vault(str(tmp_path))
        result = create_note(
            vault_path=str(tmp_path),
            title="Linked Note",
            content="Body.",
            folder="facts",
            tags=["test"],
            links=["openai-pricing", "api-retry-strategy"],
            today="2026-03-20",
        )
        text = _read_note(tmp_path, result["path"])
        assert "## Related" in text
        assert "[[openai-pricing]]" in text
        assert "[[api-retry-strategy]]" in text

    def test_raises_for_duplicate_slug(self, tmp_path):
        """create_note raises FileExistsError if the note already exists."""
        init_vault(str(tmp_path))
        create_note(
            vault_path=str(tmp_path),
            title="Duplicate Note",
            content="First.",
            folder="facts",
            tags=["test"],
            today="2026-03-20",
        )
        with pytest.raises(FileExistsError, match="already exists"):
            create_note(
                vault_path=str(tmp_path),
                title="Duplicate Note",
                content="Second.",
                folder="facts",
                tags=["test"],
                today="2026-03-20",
            )

    def test_raises_for_invalid_folder(self, tmp_path):
        """create_note raises ValueError for an unrecognised folder name."""
        init_vault(str(tmp_path))
        with pytest.raises(ValueError, match="Invalid folder"):
            create_note(
                vault_path=str(tmp_path),
                title="Bad Folder Note",
                content="Body.",
                folder="nonexistent",
                tags=["test"],
                today="2026-03-20",
            )


# ===========================================================================
# 9-12. update_note
# ===========================================================================


class TestUpdateNote:
    def _make_note(self, tmp_path: Path, title: str = "Original Note") -> str:
        """Helper: create a note and return its vault-relative path."""
        result = create_note(
            vault_path=str(tmp_path),
            title=title,
            content="Original content.",
            folder="facts",
            tags=["test"],
            today="2026-03-20",
        )
        return result["path"]

    def test_append_mode_adds_update_heading(self, tmp_path):
        """update_note (append) adds a dated ## Update heading."""
        init_vault(str(tmp_path))
        path = self._make_note(tmp_path)
        update_note(
            vault_path=str(tmp_path),
            path=path,
            content="New update content.",
            mode="append",
            today="2026-03-21",
        )
        text = _read_note(tmp_path, path)
        assert "## Update: 2026-03-21" in text
        assert "New update content." in text
        assert "Original content." in text  # original preserved

    def test_replace_mode_replaces_body(self, tmp_path):
        """update_note (replace) replaces body but preserves frontmatter."""
        init_vault(str(tmp_path))
        path = self._make_note(tmp_path)
        update_note(
            vault_path=str(tmp_path),
            path=path,
            content="Completely new body.",
            mode="replace",
            today="2026-03-21",
        )
        text = _read_note(tmp_path, path)
        assert "Completely new body." in text
        assert "Original content." not in text
        # Frontmatter should still be present
        fm, _ = _parse_frontmatter(text)
        assert fm["title"] == "Original Note"

    def test_updates_modified_date_in_frontmatter(self, tmp_path):
        """update_note bumps the modified date to today."""
        init_vault(str(tmp_path))
        path = self._make_note(tmp_path)
        update_note(
            vault_path=str(tmp_path),
            path=path,
            content="Updated.",
            today="2026-03-25",
        )
        text = _read_note(tmp_path, path)
        fm, _ = _parse_frontmatter(text)
        assert fm["modified"] == "2026-03-25"

    def test_raises_for_missing_note(self, tmp_path):
        """update_note raises FileNotFoundError when note does not exist."""
        init_vault(str(tmp_path))
        with pytest.raises(FileNotFoundError):
            update_note(
                vault_path=str(tmp_path),
                path="facts/does-not-exist.md",
                content="Content.",
            )

    def test_raises_for_invalid_mode(self, tmp_path):
        """update_note raises ValueError for unknown mode."""
        init_vault(str(tmp_path))
        path = self._make_note(tmp_path)
        with pytest.raises(ValueError, match="Invalid mode"):
            update_note(
                vault_path=str(tmp_path),
                path=path,
                content="Body.",
                mode="upsert",
            )


# ===========================================================================
# 13-17. search_notes
# ===========================================================================


class TestSearchNotes:
    def _populate(self, tmp_path: Path) -> None:
        """Create a small set of notes for search tests."""
        init_vault(str(tmp_path))
        create_note(
            vault_path=str(tmp_path),
            title="OpenAI API Rate Limits",
            content="GPT-4 has 10,000 TPM. Rate limits protect service stability.",
            folder="facts",
            tags=["api", "openai", "rate-limits"],
            today="2026-03-20",
        )
        create_note(
            vault_path=str(tmp_path),
            title="Nike Instagram Followers",
            content="Nike has 42 million Instagram followers.",
            folder="facts",
            tags=["instagram", "nike", "social-media"],
            today="2026-03-20",
        )
        create_note(
            vault_path=str(tmp_path),
            title="OpenAI",
            content="OpenAI is an AI research company based in San Francisco.",
            folder="entities",
            tags=["openai", "company", "ai"],
            today="2026-03-20",
        )

    def test_finds_by_title_keyword(self, tmp_path):
        """search_notes returns notes matching a keyword in the title."""
        self._populate(tmp_path)
        results = search_notes(str(tmp_path), query="openai")
        paths = [r["path"] for r in results]
        assert any("openai-api-rate-limits" in p for p in paths)

    def test_finds_by_body_keyword(self, tmp_path):
        """search_notes returns notes matching a keyword in the body."""
        self._populate(tmp_path)
        results = search_notes(str(tmp_path), query="42 million")
        assert len(results) >= 1
        assert any("nike" in r["path"] for r in results)

    def test_filters_by_folder(self, tmp_path):
        """search_notes with folder= only returns notes from that folder."""
        self._populate(tmp_path)
        results = search_notes(str(tmp_path), query="openai", folder="entities")
        assert all(r["path"].startswith("entities/") for r in results)

    def test_filters_by_tag(self, tmp_path):
        """search_notes with tag= only returns notes with that tag."""
        self._populate(tmp_path)
        results = search_notes(str(tmp_path), query="openai", tag="rate-limits")
        assert len(results) >= 1
        assert all("rate-limits" in r["tags"] for r in results)

    def test_all_keywords_must_match(self, tmp_path):
        """search_notes requires ALL keywords to appear in the note."""
        self._populate(tmp_path)
        # "Nike" appears but "openai" does not in the Nike note
        results = search_notes(str(tmp_path), query="nike openai")
        # No single note contains both "nike" and "openai"
        assert len(results) == 0

    def test_returns_empty_list_for_no_matches(self, tmp_path):
        """search_notes returns an empty list when nothing matches."""
        self._populate(tmp_path)
        results = search_notes(str(tmp_path), query="zzz-no-match-xyz")
        assert results == []

    def test_respects_limit(self, tmp_path):
        """search_notes does not return more results than limit."""
        self._populate(tmp_path)
        results = search_notes(str(tmp_path), query="openai", limit=1)
        assert len(results) <= 1

    def test_result_contains_expected_fields(self, tmp_path):
        """Each search result has path, title, snippet, and tags fields."""
        self._populate(tmp_path)
        results = search_notes(str(tmp_path), query="openai")
        for result in results:
            assert "path" in result
            assert "title" in result
            assert "snippet" in result
            assert "tags" in result


# ===========================================================================
# 18-19. get_note
# ===========================================================================


class TestGetNote:
    def test_returns_frontmatter_and_content(self, tmp_path):
        """get_note returns parsed frontmatter and body content."""
        init_vault(str(tmp_path))
        result = create_note(
            vault_path=str(tmp_path),
            title="Readable Note",
            content="Here is the body text.",
            folder="facts",
            tags=["test"],
            today="2026-03-20",
        )
        note = get_note(str(tmp_path), result["path"])
        assert note["frontmatter"]["title"] == "Readable Note"
        assert "Here is the body text." in note["content"]
        assert note["path"] == result["path"]

    def test_raises_for_missing_note(self, tmp_path):
        """get_note raises FileNotFoundError when note does not exist."""
        init_vault(str(tmp_path))
        with pytest.raises(FileNotFoundError):
            get_note(str(tmp_path), "facts/does-not-exist.md")


# ===========================================================================
# 20-22. list_notes
# ===========================================================================


class TestListNotes:
    def test_lists_all_notes_in_vault(self, tmp_path):
        """list_notes returns all notes across all folders."""
        init_vault(str(tmp_path))
        create_note(str(tmp_path), "Note A", "Body.", "facts", ["test"], today="2026-03-20")
        create_note(str(tmp_path), "Note B", "Body.", "entities", ["test"], today="2026-03-20")
        notes = list_notes(str(tmp_path))
        paths = [n["path"] for n in notes]
        assert any("note-a" in p for p in paths)
        assert any("note-b" in p for p in paths)

    def test_filters_to_single_folder(self, tmp_path):
        """list_notes with folder= only returns notes from that folder."""
        init_vault(str(tmp_path))
        create_note(str(tmp_path), "Fact 1", "Body.", "facts", ["test"], today="2026-03-20")
        create_note(str(tmp_path), "Entity 1", "Body.", "entities", ["test"], today="2026-03-20")
        notes = list_notes(str(tmp_path), folder="facts")
        assert all(n["path"].startswith("facts/") for n in notes)
        assert not any(n["path"].startswith("entities/") for n in notes)

    def test_excludes_obsidian_config_files(self, tmp_path):
        """list_notes does not return files from .obsidian/."""
        init_vault(str(tmp_path))
        notes = list_notes(str(tmp_path))
        assert not any(".obsidian" in n["path"] for n in notes)

    def test_result_has_expected_fields(self, tmp_path):
        """Each listed note has path, title, type, tags, modified fields."""
        init_vault(str(tmp_path))
        create_note(str(tmp_path), "Field Check", "Body.", "facts", ["a", "b"], today="2026-03-20")
        notes = list_notes(str(tmp_path), folder="facts")
        # Filter to our specific note
        target = next((n for n in notes if "field-check" in n["path"]), None)
        assert target is not None
        assert target["title"] == "Field Check"
        assert target["type"] == "fact"
        assert "a" in target["tags"]
        assert target["modified"] == "2026-03-20"


# ===========================================================================
# 23-25. find_backlinks
# ===========================================================================


class TestFindBacklinks:
    def test_finds_basic_wiki_link(self, tmp_path):
        """find_backlinks finds notes with [[target]] links."""
        init_vault(str(tmp_path))
        # Create target note
        create_note(str(tmp_path), "Target Note", "This is the target.", "facts", ["test"], today="2026-03-20")
        # Create referencing note
        create_note(
            str(tmp_path),
            "Referencing Note",
            "This refers to [[target-note]] which is important.",
            "facts",
            ["test"],
            today="2026-03-20",
        )
        results = find_backlinks(str(tmp_path), "target-note")
        assert len(results) >= 1
        assert any("referencing-note" in r["path"] for r in results)

    def test_finds_display_text_wiki_link(self, tmp_path):
        """find_backlinks finds [[note-name|display text]] links."""
        init_vault(str(tmp_path))
        create_note(str(tmp_path), "Target", "Target body.", "facts", ["test"], today="2026-03-20")
        create_note(
            str(tmp_path),
            "Linker",
            "See [[target|the target note]] for details.",
            "facts",
            ["test"],
            today="2026-03-20",
        )
        results = find_backlinks(str(tmp_path), "target")
        assert any("linker" in r["path"] for r in results)

    def test_returns_empty_when_no_links(self, tmp_path):
        """find_backlinks returns an empty list when no notes link to target."""
        init_vault(str(tmp_path))
        create_note(str(tmp_path), "Lonely Note", "Nobody links here.", "facts", ["test"], today="2026-03-20")
        results = find_backlinks(str(tmp_path), "lonely-note")
        assert results == []

    def test_does_not_match_partial_names(self, tmp_path):
        """find_backlinks does not match partial wiki-link names."""
        init_vault(str(tmp_path))
        create_note(str(tmp_path), "Short", "Body.", "facts", ["test"], today="2026-03-20")
        create_note(
            str(tmp_path),
            "Links To Shorter Note",
            "See [[short-version]] for a related but different note.",
            "facts",
            ["test"],
            today="2026-03-20",
        )
        results = find_backlinks(str(tmp_path), "short")
        assert results == []

    def test_result_contains_expected_fields(self, tmp_path):
        """Each backlink result has path, title, and snippet fields."""
        init_vault(str(tmp_path))
        create_note(str(tmp_path), "Target", "Target body.", "facts", ["test"], today="2026-03-20")
        create_note(
            str(tmp_path),
            "Linker",
            "Links to [[target]].",
            "facts",
            ["test"],
            today="2026-03-20",
        )
        results = find_backlinks(str(tmp_path), "target")
        assert len(results) >= 1
        result = results[0]
        assert "path" in result
        assert "title" in result
        assert "snippet" in result


# ===========================================================================
# 26. commit_and_push (no-git degradation)
# ===========================================================================


class TestCommitAndPush:
    def test_degrades_gracefully_without_git_repo(self, tmp_path):
        """commit_and_push returns a non-error dict when no git repo present."""
        # tmp_path is not a git repo
        result = commit_and_push(str(tmp_path), "test commit")
        assert isinstance(result, dict)
        assert "committed" in result
        assert "pushed" in result
        assert "message" in result
        assert result["committed"] is False
        assert result["pushed"] is False
