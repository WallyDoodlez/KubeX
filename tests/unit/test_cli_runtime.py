"""Unit tests for kubex_harness.cli_runtime — CLI subprocess runtime.

Stubs created in Wave 0. Implementation fills these in Plan 03 Task 2.
"""
import pytest


# --- CliState enum ---

def test_cli_state_enum():
    pytest.skip("Stub — Plan 03")


# --- Credential detection (CLI-02) ---

def test_credentials_missing(tmp_path):
    pytest.skip("Stub — Plan 03")


def test_credentials_empty(tmp_path):
    pytest.skip("Stub — Plan 03")


def test_credentials_present(tmp_path):
    pytest.skip("Stub — Plan 03")


def test_credentials_unknown_runtime():
    pytest.skip("Stub — Plan 03")


# --- PTY spawn (CLI-01) ---

def test_pty_spawn_success():
    pytest.skip("Stub — Plan 03")


def test_large_output_no_deadlock():
    pytest.skip("Stub — Plan 03")


# --- Failure classification (CLI-03) ---

def test_failure_classification_auth_expired():
    pytest.skip("Stub — Plan 03")


def test_failure_classification_subscription_limit():
    pytest.skip("Stub — Plan 03")


def test_failure_classification_runtime_not_available():
    pytest.skip("Stub — Plan 03")


def test_failure_classification_cli_crash():
    pytest.skip("Stub — Plan 03")


def test_failure_classification_success():
    pytest.skip("Stub — Plan 03")


# --- Command building (CLI-08) ---

def test_command_includes_required_flags():
    pytest.skip("Stub — Plan 03")


def test_command_includes_model():
    pytest.skip("Stub — Plan 03")


def test_command_no_model_when_empty():
    pytest.skip("Stub — Plan 03")


# --- Lifecycle state machine (CLI-07) ---

def test_lifecycle_state_published():
    pytest.skip("Stub — Plan 03")


def test_boot_sequence_credential_wait():
    pytest.skip("Stub — Plan 03")


def test_task_loop_state_transitions():
    pytest.skip("Stub — Plan 03")


# --- HITL credential flow (CLI-02) ---

def test_hitl_triggered_on_missing_creds():
    pytest.skip("Stub — Plan 03")


def test_credential_watcher_detects_file():
    pytest.skip("Stub — Plan 03")


# --- Signal forwarding (CLI-04) ---

def test_sigterm_forwarding():
    pytest.skip("Stub — Plan 03")


def test_sigkill_escalation():
    pytest.skip("Stub — Plan 03")


# --- CLAUDE.md skill injection (CLI-05) ---

def test_claude_md_written():
    pytest.skip("Stub — Plan 03")


# --- Retry logic ---

def test_auth_expired_bypasses_retry():
    pytest.skip("Stub — Plan 03")
