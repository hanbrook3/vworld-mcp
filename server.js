/**
 * V-World 공간정보 MCP Server
 * 브이월드 오픈API를 Claude에서 사용할 수 있게 해주는 MCP 서버
 *
 * 제공 도구 목록:
 * 1. search_address     - 주소/지명 검색
 * 2. reverse_geocode    - 좌표 → 주소 변환
 * 3. get_parcel_info    - 토지(필지) 정보 조회
 * 4. get_building_info  - 건물 정보 조회
 * 5. get_land_use       - 용도지역 / 토지이용현황 조회
 * 6. get_admin_district - 행정구역 정보 조회
 */

import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { z } from "zod";

const app = express();
app.use(express.json());

// ─────────────────────────────────────────────
// 환경변수 또는 쿼리파라미터로 API 키 전달
// 쿼리: ?key=YOUR_API_KEY
// 환경변수: VWORLD_API_KEY=YOUR_API_KEY
// ─────────────────────────────────────────────
const DEFAULT_API_KEY = process.env.VWORLD_API_KEY || "";
const PORT = process.env.PORT || 3000;
const BASE_URL = "https://api.vworld.kr";

// ─────────────────────────────────────────────
// 공통 fetch 유틸리티
// ─────────────────────────────────────────────
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
    return { error: err.message, url: url.toString() };
  }
}

// ─────────────────────────────────────────────
// MCP 서버 생성 함수 (요청마다 새 인스턴스)
// API 키를 요청별로 다르게 받을 수 있도록 설계
// ─────────────────────────────────────────────
function createMcpServer(apiKey) {
  const server = new McpServer({
    name: "vworld-mcp",
    version: "1.0.0",
  });

  // ───────────────────────────────────────────
  // 도구 1: 주소 / 지명 검색
  // ───────────────────────────────────────────
  server.tool(
    "search_address",
    "주소 또는 지명으로 위치를 검색합니다. 도로명주소, 지번주소, 장소명 모두 검색 가능합니다.",
    {
      query: z.string().describe("검색할 주소 또는 지명 (예: 서울 강남구 역삼동, 노량진동 58-29)"),
      type: z
        .enum(["ADDRESS", "PLACE"])
        .optional()
        .default("ADDRESS")
        .describe("검색 유형: ADDRESS=주소, PLACE=장소"),
      size: z
        .number()
        .optional()
        .default(10)
        .describe("결과 개수 (1~100, 기본 10)"),
    },
    async ({ query, type, size }) => {
      const data = await vworldFetch("/req/search", {
        service: "search",
        request: "search",
        version: "2.0",
        crs: "EPSG:4326",
        size,
        page: 1,
        query,
        type,
        key: apiKey,
      });

      if (data.error) {
        return {
          content: [{ type: "text", text: `오류: ${data.error}\n요청URL: ${data.url}` }],
        };
      }

      const status = data.response?.status;
      if (status !== "OK") {
        return {
          content: [{ type: "text", text: `검색 결과 없음 (status: ${status})` }],
        };
      }

      const items = data.response?.result?.items || [];
      const formatted = items.map((item, i) => {
        const addr = item.address || {};
        const point = item.point || {};
        return [
          `[${i + 1}] ${addr.road || addr.parcel || item.title || "정보없음"}`,
          `    지번: ${addr.parcel || "-"}`,
          `    도로명: ${addr.road || "-"}`,
          `    좌표(경위도): 경도 ${point.x || "-"}, 위도 ${point.y || "-"}`,
          `    카테고리: ${item.category || "-"}`,
        ].join("\n");
      });

      return {
        content: [
          {
            type: "text",
            text: `검색결과 총 ${items.length}건\n\n${formatted.join("\n\n")}`,
          },
        ],
      };
    }
  );

  // ───────────────────────────────────────────
  // 도구 2: 역지오코딩 (좌표 → 주소)
  // ───────────────────────────────────────────
  server.tool(
    "reverse_geocode",
    "경위도 좌표를 도로명주소와 지번주소로 변환합니다.",
    {
      longitude: z.number().describe("경도 (예: 126.9780)"),
      latitude: z.number().describe("위도 (예: 37.5665)"),
    },
    async ({ longitude, latitude }) => {
      const data = await vworldFetch("/req/address", {
        service: "address",
        request: "getAddress",
        version: "2.0",
        crs: "epsg:4326",
        point: `${longitude},${latitude}`,
        type: "both",
        zipcode: true,
        simple: false,
        key: apiKey,
      });

      if (data.error) {
        return {
          content: [{ type: "text", text: `오류: ${data.error}` }],
        };
      }

      const results = data.response?.result || [];
      if (!results.length) {
        return {
          content: [{ type: "text", text: "해당 좌표의 주소를 찾을 수 없습니다." }],
        };
      }

      const formatted = results.map((r) => {
        const structure = r.structure || {};
        return [
          `[${r.type === "road" ? "도로명" : "지번"}]`,
          `  전체주소: ${r.text || "-"}`,
          `  시도: ${structure.level0 || "-"}`,
          `  시군구: ${structure.level1 || "-"}`,
          `  읍면동: ${structure.level2 || "-"}`,
          `  번지: ${structure.level4L || structure.detail || "-"}`,
        ].join("\n");
      });

      return {
        content: [
          {
            type: "text",
            text: `좌표 (${longitude}, ${latitude}) 주소 변환 결과:\n\n${formatted.join("\n\n")}`,
          },
        ],
      };
    }
  );

  // ───────────────────────────────────────────
  // 도구 3: 토지(필지) 정보 조회
  // ───────────────────────────────────────────
  server.tool(
    "get_parcel_info",
    "PNU코드로 토지(필지) 경계 및 속성 정보를 조회합니다. PNU코드는 법정동코드(10자리)+대장구분(1자리)+본번(4자리)+부번(4자리) = 19자리입니다.",
    {
      pnu: z
        .string()
        .describe("PNU코드 19자리 (예: 1168010200100010000)"),
      returnGeometry: z
        .boolean()
        .optional()
        .default(false)
        .describe("경계 좌표 반환 여부 (true/false)"),
    },
    async ({ pnu, returnGeometry }) => {
      const data = await vworldFetch("/req/data", {
        service: "data",
        request: "GetFeature",
        data: "LP_PA_CBND_BUBUN",
        key: apiKey,
        attrFilter: `pnu:=:${pnu}`,
        page: 1,
        size: 10,
        geometry: returnGeometry,
      });

      if (data.error) {
        return {
          content: [{ type: "text", text: `오류: ${data.error}` }],
        };
      }

      const status = data.response?.status;
      if (status === "NOT_FOUND" || status === "error") {
        return {
          content: [{ type: "text", text: `PNU(${pnu})에 해당하는 토지 정보를 찾을 수 없습니다.` }],
        };
      }

      const features =
        data.response?.result?.featureCollection?.features || [];
      if (!features.length) {
        return {
          content: [{ type: "text", text: "결과 없음" }],
        };
      }

      const props = features[0]?.properties || {};
      const lines = [
        `PNU: ${props.pnu || pnu}`,
        `지목: ${props.lndcgr_nm || props.lndcgrcd || "-"}`,
        `면적: ${props.lndpclAr || props.area || "-"} ㎡`,
        `소재지: ${props.address || props.addr || "-"}`,
        `공시지가: ${props.pblntfPclnd || "-"} 원/㎡`,
      ];

      if (returnGeometry && features[0]?.geometry) {
        lines.push(`경계좌표: ${JSON.stringify(features[0].geometry).slice(0, 200)}...`);
      }

      return {
        content: [
          {
            type: "text",
            text: `토지 정보 조회 결과:\n\n${lines.join("\n")}`,
          },
        ],
      };
    }
  );

  // ───────────────────────────────────────────
  // 도구 4: 건물 정보 조회
  // ───────────────────────────────────────────
  server.tool(
    "get_building_info",
    "건물명 또는 주소로 건물 정보를 검색합니다.",
    {
      query: z
        .string()
        .describe("건물명 또는 주소 (예: 서울시청, 서울특별시 중구 세종대로 110)"),
      size: z.number().optional().default(5).describe("결과 개수"),
    },
    async ({ query, size }) => {
      const data = await vworldFetch("/req/search", {
        service: "search",
        request: "search",
        version: "2.0",
        crs: "EPSG:4326",
        size,
        page: 1,
        query,
        type: "PLACE",
        category: "L4",
        key: apiKey,
      });

      if (data.error) {
        return {
          content: [{ type: "text", text: `오류: ${data.error}` }],
        };
      }

      const items = data.response?.result?.items || [];
      if (!items.length) {
        return {
          content: [{ type: "text", text: "검색 결과가 없습니다." }],
        };
      }

      const formatted = items.map((item, i) => {
        const point = item.point || {};
        return [
          `[${i + 1}] ${item.title || "-"}`,
          `    주소: ${item.address?.road || item.address?.parcel || "-"}`,
          `    카테고리: ${item.category || "-"}`,
          `    좌표: 경도 ${point.x || "-"}, 위도 ${point.y || "-"}`,
        ].join("\n");
      });

      return {
        content: [
          {
            type: "text",
            text: `건물 검색결과 ${items.length}건:\n\n${formatted.join("\n\n")}`,
          },
        ],
      };
    }
  );

  // ───────────────────────────────────────────
  // 도구 5: 용도지역 / 토지이용현황 조회
  // ───────────────────────────────────────────
  server.tool(
    "get_land_use",
    "특정 위치의 용도지역·용도지구·토지이용현황을 조회합니다. 건축법규 검토에 활용 가능합니다.",
    {
      longitude: z.number().describe("경도"),
      latitude: z.number().describe("위도"),
    },
    async ({ longitude, latitude }) => {
      // 용도지역지구 조회 (국토계획법 기반)
      const data = await vworldFetch("/req/data", {
        service: "data",
        request: "GetFeature",
        data: "LT_C_UQ111",  // 용도지역
        key: apiKey,
        geometry: false,
        attribute: true,
        size: 5,
        page: 1,
        geomFilter: `POINT(${longitude} ${latitude})`,
        crs: "EPSG:4326",
      });

      if (data.error) {
        return {
          content: [{ type: "text", text: `오류: ${data.error}` }],
        };
      }

      const features =
        data.response?.result?.featureCollection?.features || [];

      if (!features.length) {
        return {
          content: [
            {
              type: "text",
              text: `좌표(${longitude}, ${latitude}) 위치의 용도지역 정보를 찾을 수 없습니다.\n국토계획법상 용도지역이 미지정된 지역이거나 좌표를 확인해주세요.`,
            },
          ],
        };
      }

      const props = features[0]?.properties || {};
      const lines = [
        `조회 좌표: 경도 ${longitude}, 위도 ${latitude}`,
        `용도지역: ${props.uq111 || props.ugbn || props.zbNm || "-"}`,
        `지정일자: ${props.apd || props.zon_dsgn_dt || "-"}`,
        `지정기관: ${props.zbOrg || "-"}`,
        `비고: ${props.rm || "-"}`,
      ];

      return {
        content: [
          {
            type: "text",
            text: `용도지역 조회 결과:\n\n${lines.join("\n")}`,
          },
        ],
      };
    }
  );

  // ───────────────────────────────────────────
  // 도구 6: 행정구역 정보 조회
  // ───────────────────────────────────────────
  server.tool(
    "get_admin_district",
    "시도/시군구/읍면동 등 행정구역 정보를 조회합니다.",
    {
      query: z
        .string()
        .describe("행정구역명 (예: 강남구, 서초동, 역삼1동)"),
      level: z
        .enum(["sido", "sigungu", "eupmyeondong"])
        .optional()
        .default("sigungu")
        .describe("행정구역 단계: sido=시도, sigungu=시군구, eupmyeondong=읍면동"),
    },
    async ({ query, level }) => {
      const dataMap = {
        sido: "LT_C_ADSIDO_INFO",
        sigungu: "LT_C_ADSIGG_INFO",
        eupmyeondong: "LT_C_ADEMD_INFO",
      };

      const colMap = {
        sido: "ctprvn_nm",
        sigungu: "sig_kor_nm",
        eupmyeondong: "emd_kor_nm",
      };

      const data = await vworldFetch("/req/data", {
        service: "data",
        request: "GetFeature",
        data: dataMap[level],
        key: apiKey,
        attrFilter: `${colMap[level]}:like:${query}`,
        geometry: false,
        columns: "full_nm",
        page: 1,
        size: 20,
        format: "json",
      });

      if (data.error) {
        return {
          content: [{ type: "text", text: `오류: ${data.error}` }],
        };
      }

      const features =
        data.response?.result?.featureCollection?.features || [];
      if (!features.length) {
        return {
          content: [{ type: "text", text: `'${query}' 행정구역을 찾을 수 없습니다.` }],
        };
      }

      const formatted = features.map((f, i) => {
        const p = f.properties || {};
        return `[${i + 1}] ${p.full_nm || p.ctprvn_nm || p.sig_kor_nm || p.emd_kor_nm || JSON.stringify(p)}`;
      });

      return {
        content: [
          {
            type: "text",
            text: `행정구역 검색결과 ${features.length}건:\n\n${formatted.join("\n")}`,
          },
        ],
      };
    }
  );

  return server;
}

// ─────────────────────────────────────────────
// Express 라우팅 (SSE Transport)
// ─────────────────────────────────────────────
const transports = {};

app.get("/mcp", async (req, res) => {
  // 쿼리파라미터로 API 키 전달: ?key=YOUR_API_KEY
  const apiKey = req.query.key || DEFAULT_API_KEY;

  if (!apiKey) {
    return res.status(401).json({
      error: "V-World API 키가 필요합니다. ?key=YOUR_API_KEY 형식으로 전달하세요.",
    });
  }

  const server = createMcpServer(apiKey);
  const transport = new SSEServerTransport("/messages", res);
  transports[transport.sessionId] = transport;

  res.on("close", () => {
    delete transports[transport.sessionId];
  });

  await server.connect(transport);
});

app.post("/messages", async (req, res) => {
  const sessionId = req.query.sessionId;
  const transport = transports[sessionId];
  if (transport) {
    await transport.handlePostMessage(req, res);
  } else {
    res.status(404).json({ error: "세션을 찾을 수 없습니다." });
  }
});

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "vworld-mcp",
    version: "1.0.0",
    tools: [
      "search_address",
      "reverse_geocode",
      "get_parcel_info",
      "get_building_info",
      "get_land_use",
      "get_admin_district",
    ],
  });
});

app.listen(PORT, () => {
  console.log(`V-World MCP Server 시작 — PORT ${PORT}`);
  console.log(`헬스체크: http://localhost:${PORT}/health`);
  console.log(`MCP 엔드포인트: http://localhost:${PORT}/mcp?key=YOUR_API_KEY`);
});
