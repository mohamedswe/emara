import { Hono } from "hono";

const runtime = new Hono();

function health() {}

runtime.get("/health", health);
