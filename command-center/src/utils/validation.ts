export interface ValidationResult {
  valid: boolean;
  error?: string;
}

export function validateCapability(value: string): ValidationResult {
  const trimmed = value.trim();
  if (!trimmed) return { valid: false, error: 'Capability is required' };
  if (trimmed.length > 100) return { valid: false, error: 'Capability too long (max 100 chars)' };
  if (!/^[a-zA-Z0-9_.\-]+$/.test(trimmed)) {
    return { valid: false, error: 'Only letters, numbers, underscore, dot, hyphen allowed' };
  }
  return { valid: true };
}

export function validateMessage(value: string): ValidationResult {
  const trimmed = value.trim();
  if (!trimmed) return { valid: false, error: 'Message is required' };
  if (trimmed.length > 10_000) return { valid: false, error: 'Message too long (max 10,000 chars)' };
  return { valid: true };
}
