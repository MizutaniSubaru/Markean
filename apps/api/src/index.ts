import { Hono } from "hono";
import type { Env } from "./env";
import { bootstrapRoutes } from "./routes/bootstrap";
import { devSessionRoutes } from "./routes/dev-session";
import { healthRoutes } from "./routes/health";

const app = new Hono<{ Bindings: Env }>();

app.route("/", healthRoutes);
app.route("/", devSessionRoutes);
app.route("/", bootstrapRoutes);

export default app;
