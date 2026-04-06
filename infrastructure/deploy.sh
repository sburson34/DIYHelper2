#!/bin/bash
set -euo pipefail

# DIYHelper2 API - CloudFormation deployment script
# Usage: ./deploy.sh [SECRET_ARN]

STACK_NAME="diyhelper2-api"
REGION="us-east-1"
SECRET_ARN="${1:-arn:aws:secretsmanager:us-east-1:514994861622:secret:OpenAI_APIKEY-yVJyyp}"

echo "==> Deploying CloudFormation stack: $STACK_NAME"
echo "    Region: $REGION"
echo "    Secret ARN: $SECRET_ARN"
echo ""

aws cloudformation deploy \
  --template-file cloudformation.yaml \
  --stack-name "$STACK_NAME" \
  --region "$REGION" \
  --parameter-overrides \
    SecretArn="$SECRET_ARN" \
  --capabilities CAPABILITY_NAMED_IAM \
  --no-fail-on-empty-changeset

echo ""
echo "==> Stack outputs:"
aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --region "$REGION" \
  --query 'Stacks[0].Outputs' \
  --output table

echo ""
echo "==> Next steps:"
echo "  1. cd backend/DIYHelper2.Api"
echo "  2. dotnet publish -c Release --self-contained -r linux-x64"
echo "  3. cd bin/Release/net10.0/publish"
echo "  4. zip -r deploy.zip ."
echo "  5. eb deploy  (or upload deploy.zip via EB console)"