import { hc } from "hono/client";

import type { ApiType } from "../../worker";

export const api = hc<ApiType>("/api");
