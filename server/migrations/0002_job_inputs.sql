-- What the user supplied with the brief: {"<field key>": {"text": "..."} | {"files": ["inputs/<key>/<name>", ...]}}
ALTER TABLE jobs ADD COLUMN inputs_json TEXT NOT NULL DEFAULT '{}';
