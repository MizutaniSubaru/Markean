import { createApiClient } from "@markean/api-client";

export function createBootstrapApi(baseUrl = "") {
  return createApiClient(baseUrl);
}
