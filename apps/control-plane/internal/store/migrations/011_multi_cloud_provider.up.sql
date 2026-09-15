-- Migration 011: Update cloud_credentials provider field to support multiple cloud platforms
-- The provider field was previously hardcoded to 'aliyun', now we allow multiple values

-- Remove any existing check constraint on provider field
ALTER TABLE cloud_credentials DROP CONSTRAINT IF EXISTS cloud_credentials_provider_check;

-- Update the provider column type to support longer provider names
ALTER TABLE cloud_credentials ALTER COLUMN provider TYPE varchar(50);

-- Add a check constraint to limit supported providers (can be extended in the future)
ALTER TABLE cloud_credentials ADD CONSTRAINT cloud_credentials_provider_check
    CHECK (provider IN ('aliyun', 'aws', 'tencentcloud', 'huaweicloud'));

-- Add comment to document the provider field
COMMENT ON COLUMN cloud_credentials.provider IS 'Cloud platform provider: aliyun, aws, tencentcloud, huaweicloud';
