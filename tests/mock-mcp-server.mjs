import http from "node:http";

const port = Number(process.env.MOCK_MCP_PORT || "39099");

const server = http.createServer(async (req, res) => {
  if (req.method !== "POST" || req.url !== "/mcp") {
    res.statusCode = req.method === "GET" ? 405 : 404;
    res.end();
    return;
  }

  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const text = Buffer.concat(chunks).toString("utf8");
  const message = text ? JSON.parse(text) : {};

  if (message.method === "notifications/initialized") {
    res.statusCode = 202;
    res.end();
    return;
  }

  res.setHeader("content-type", "application/json");
  if (message.method === "initialize") {
    res.setHeader("mcp-session-id", "paseo-mcp-selftest");
    res.end(JSON.stringify({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        protocolVersion: message.params?.protocolVersion ?? "2025-11-25",
        capabilities: { tools: {} },
        serverInfo: { name: "paseo-mcp-selftest", version: "0.1.0" },
      },
    }));
    return;
  }

  if (message.method === "tools/list") {
    res.end(JSON.stringify({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        tools: [{
          name: "paseo_echo",
          description: "Echo a string for Paseo MCP integration testing",
          inputSchema: {
            type: "object",
            properties: { text: { type: "string" } },
            required: ["text"],
            additionalProperties: false,
          },
        }],
      },
    }));
    return;
  }

  if (message.method === "tools/call" && message.params?.name === "paseo_echo") {
    const value = String(message.params?.arguments?.text ?? "");
    res.end(JSON.stringify({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        content: [{ type: "text", text: value }],
        isError: false,
      },
    }));
    return;
  }

  res.end(JSON.stringify({
    jsonrpc: "2.0",
    id: message.id ?? null,
    error: { code: -32601, message: "Method not found" },
  }));
});

server.listen(port, "127.0.0.1", () => {
  console.log(`mock MCP listening on http://127.0.0.1:${port}/mcp`);
});
