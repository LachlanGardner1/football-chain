import type { OpenNextConfig } from "@opennextjs/aws/types/open-next.js";

// This app has no getStaticProps/revalidate/ISR usage (every route is either a static
// client page or a dynamic API route), so the ISR machinery OpenNext provisions by
// default (S3-backed incremental cache, DynamoDB tag cache, SQS revalidation queue)
// is unnecessary cost/complexity. Disabling it keeps the deployed topology to just
// Lambda + CloudFront + S3-for-static-assets.
const config: OpenNextConfig = {
  default: {
    override: {
      wrapper: "aws-lambda",
      converter: "aws-apigw-v2",
      incrementalCache: "dummy",
      tagCache: "dummy",
      queue: "dummy",
    },
  },
  dangerous: {
    disableIncrementalCache: true,
    disableTagCache: true,
  },
  // Next.js's standalone build always copies a local .env/.env.production into
  // .next/standalone if one exists on the machine running the build, and OpenNext then
  // copies that straight into every deployable function bundle. Production config/secrets
  // are injected as real Lambda environment variables at deploy time instead, so strip
  // those copies right after `next build` (there is no OpenNext config flag for this).
  buildCommand:
    "next build && rm -f .next/standalone/.env .next/standalone/.env.production",
};

export default config;
