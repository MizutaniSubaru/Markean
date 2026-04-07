import { Hono } from "hono";
import type { Env } from "./env";
import { bootstrapRoutes } from "./routes/bootstrap";
import { devSessionRoutes } from "./routes/dev-session";
import { healthRoutes } from "./routes/health";
import { folderRoutes } from "./routes/folders";
import { noteRoutes } from "./routes/notes";

const app = new Hono<{ Bindings: Env }>();

app.route("/", healthRoutes);
app.route("/", devSessionRoutes);
app.route("/", bootstrapRoutes);
app.route("/", folderRoutes);
app.route("/", noteRoutes);

export default app;
