/**
 * V-World 공간정보 MCP Server (Streamable HTTP)
 */
import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

const app = express();
app.use(express.json());

const DEFAULT_API_KEY = process.env.VWORLD_API_KEY || "";
const PORT = process.env.PORT || 10000;
const BASE_URL = "https://api.vworld.kr";

// CORS
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.header("Access-Control-Allow-Headers", "*");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

async function vworldFetch(endpoint, params) {
  const url = new URL(endpoint, BASE_URL);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  });
  url.searchParams.set("format", "json");
  try {
    const res = await fetch(url.toString());
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    return { error: err.message };
  }
}

function createMcpServer(apiKey) {
  const server = new McpServer({ name: "vworld-mcp", version: "1.0.0" });

  server.tool(
    "search_address",
    "주소 또는 지명으로 위치를 검색합니다",
    { query: z.string().describe("검색할 주소 또는 지명"), size: z.number().optional().default(10) },
    async ({ query, size }) => {
      const data = await vworldFetch("/req/search", {
        service: "search", request: "search", version: "2.0",
        crs: "EPSG:4326", size, page: 1, query, type: "ADDRESS", key: apiKey,
      });
      if (data.error) return { content: [{ type: "text", text: `오류: ${data.error}` }] };
      const items = data.response?.result?.items || [];
      if (!items.length) return { content: [{ type: "text", text: "검색 결과 없음" }] };
      const formatted = items.map((item, i) => {
        const addr = item.address || {};
        const point = item.point || {};
        return `[${i+1}] 도로명: ${addr.road||"-"}\n    지번: ${addr.parcel||"-"}\n    좌표: 경도 ${point.x||"-"}, 위도 ${point.y||"-"}`;
      });
      return { content: [{ type: "text", text: `검색결과 ${items.length}건\n\n${formatted.join("\n\n")}` }] };
    }
  );

  server.tool(
    "reverse_geocode",
    "경위도 좌표를 주소로 변환합니다",
    { longitude: z.number().describe("경도"), latitude: z.number().describe("위도") },
    async ({ longitude, latitude }) => {
      const data = await vworldFetch("/req/address", {
        service: "address", request: "getAddress", version: "2.0",
        crs: "epsg:4326", point: `${longitude},${latitude}`, type: "both",
        zipcode: true, simple: false, key: apiKey,
      });
      if (data.error) return { content: [{ type: "text", text: `오류: ${data.error}` }] };
      const results = data.response?.result || [];
      if (!results.length) return { content: [{ type: "text", text: "주소 없음" }] };
      const formatted = results.map(r => `[${r.type==="road"?"도로명":"지번"}] ${r.text||"-"}`);
      return { content: [{ type: "text", text: formatted.join("\n") }] };
    }
  );

  server.tool(
    "get_parcel_info",
    "PNU코드로 토지(필지) 정보를 조회합니다",
    { pnu: z.string().describe("PNU코드 19자리") },
    async ({ pnu }) => {
      const data = await vworldFetch("/req/data", {
        service: "data", request: "GetFeature", data: "LP_PA_CBND_BUBUN",
        key: apiKey, attrFilter: `pnu:=:${pnu}`, page: 1, size: 10, geometry: false,
      });
      if (data.error) return { content: [{ type: "text", text: `오류: ${data.error}` }] };
      const features = data.response?.result?.featureCollection?.features || [];
      if (!features.length) return { content: [{ type: "text", text: "결과 없음" }] };
      const props = features[0]?.properties || {};
      return { content: [{ type: "text", text: `PNU: ${pnu}\n지목: ${props.lndcgr_nm||"-"}\n면적: ${props.lndpclAr||"-"} ㎡` }] };
    }
  );

  server.tool(
    "get_land_use",
    "좌표로 용도지역을 조회합니다",
    { longitude: z.number().describe("경도"), latitude: z.number().describe("위도") },
    async ({ longitude, latitude }) => {
      const data = await vworldFetch("/req/data", {
        service: "data", request: "GetFeature", data: "LT_C_UQ111",
        key: apiKey, geometry: false, attribute: true, size: 5, page: 1,
        geomFilter: `POINT(${longitude} ${latitude})`, crs: "EPSG:4326",
      });
      if (data.error) return { content: [{ type: "text", text: `오류: ${data.error}` }] };
      const features = data.response?.result?.featureCollection?.features || [];
      if (!features.length) return { content: [{ type: "text", text: "용도지역 정보 없음" }] };
      const props = features[0]?.properties || {};
      return { content: [{ type: "text", text: `용도지역: ${props.uq111||props.ugbn||"-"}` }] };
    }
  );

  server.tool(
    "get_building_info",
    "건물명 또는 주소로 건물을 검색합니다",
    { query: z.string().describe("건물명 또는 주소"), size: z.number().optional().default(5) },
    async ({ query, size }) => {
      const data = await vworldFetch("/req/search", {
        service: "search", request: "search", version: "2.0",
        crs: "EPSG:4326", size, page: 1, query, type: "PLACE", key: apiKey,
      });
      if (data.error) return { content: [{ type: "text", text: `오류: ${data.error}` }] };
      const items = data.response?.result?.items || [];
      if (!items.length) return { content: [{ type: "text", text: "검색 결과 없음" }] };
      const formatted = items.map((item, i) => {
        const point = item.point || {};
        return `[${i+1}] ${item.title||"-"}\n    주소: ${item.address?.road||item.address?.parcel||"-"}\n    좌표: 경도 ${point.x||"-"}, 위도 ${point.y||"-"}`;
      });
      return { content: [{ type: "text", text: `${items.length}건\n\n${formatted.join("\n\n")}` }] };
    }
  );

  server.tool(
    "get_admin_district",
    "행정구역 정보를 조회합니다",
    { query: z.string().describe("행정구역명 (예: 강남구, 서초동)") },
    async ({ query }) => {
      const data = await vworldFetch("/req/data", {
        service: "data", request: "GetFeature", data: "LT_C_ADSIGG_INFO",
        key: apiKey, attrFilter: `sig_kor_nm:like:${query}`,
        geometry: false, columns: "full_nm", page: 1, size: 20,
      });
      if (data.error) return { content: [{ type: "text", text: `오류: ${data.error}` }] };
      const features = data.response?.result?.featureCollection?.features || [];
      if (!features.length) return { content: [{ type: "text", text: "결과 없음" }] };
      const formatted = features.map((f, i) => `[${i+1}] ${f.properties?.full_nm||"-"}`);
      return { content: [{ type: "text", text: formatted.join("\n") }] };
    }
  );

  return server;
}

// Streamable HTTP 엔드포인트
app.all("/mcp", async (req, res) => {
  const apiKey = req.query.key || DEFAULT_API_KEY;
  if (!apiKey) return res.status(401).json({ error: "API 키 필요: ?key=YOUR_API_KEY" });

  try {
    const server = createMcpServer(apiKey);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("MCP 오류:", err);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "vworld-mcp", version: "2.0.0",
    tools: ["search_address","reverse_geocode","get_parcel_info","get_land_use","get_building_info","get_admin_district"] });
});

app.listen(PORT, () => {
  console.log(`V-World MCP Server 시작 — PORT ${PORT}`);
  console.log(`헬스체크: http://localhost:${PORT}/health`);
  console.log(`MCP 엔드포인트: http://localhost:${PORT}/mcp?key=YOUR_API_KEY`);
});
