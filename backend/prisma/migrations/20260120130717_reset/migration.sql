-- AlterTable
ALTER TABLE "project_config" ALTER COLUMN "llmModel" SET DEFAULT 'gpt-5.2';

-- AlterTable
ALTER TABLE "settings_versions" ALTER COLUMN "models" SET DEFAULT '{"primary": "gpt-5.2", "fallback": "gpt-4o", "timeoutMs": 8000, "retries": 2, "stream": true}';
