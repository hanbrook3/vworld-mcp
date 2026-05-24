# V-World MCP Server

브이월드(V-World) 공간정보 오픈API를 Claude AI에서 사용할 수 있게 해주는 MCP 서버입니다.

## 제공 도구 (Tools)

| 도구명 | 기능 |
|--------|------|
| `search_address` | 주소·지명 검색 |
| `reverse_geocode` | 좌표 → 주소 변환 |
| `get_parcel_info` | 토지(필지) 정보 조회 |
| `get_building_info` | 건물 정보 조회 |
| `get_land_use` | 용도지역·토지이용현황 조회 |
| `get_admin_district` | 행정구역 정보 조회 |

---

## 배포 방법 (Railway 기준)

### 1. GitHub 업로드
```bash
git init
git add .
git commit -m "init vworld-mcp"
git remote add origin https://github.com/YOUR_USERNAME/vworld-mcp.git
git push -u origin main
```

### 2. Railway 배포
1. https://railway.app 접속 → GitHub으로 로그인
2. [New Project] → [Deploy from GitHub repo] → 저장소 선택
3. [Variables] 탭에서 환경변수 설정:
   - `VWORLD_API_KEY` = 브이월드 API 키
   - `PORT` = 3000 (자동 설정됨)
4. 배포 완료 후 도메인 확인 (예: vworld-mcp-xxx.up.railway.app)

### 3. 브이월드 API 도메인 등록
브이월드 사이트 → 오픈API → 인증키관리 → 도메인 등록
- Railway에서 발급된 도메인 추가

### 4. Claude 커스텀 커넥터 등록
- Claude → Settings → Connectors → Add Custom Connector
- URL: `https://vworld-mcp-xxx.up.railway.app/mcp?key=YOUR_API_KEY`

---

## 로컬 테스트

```bash
npm install
VWORLD_API_KEY=your_key npm start
# http://localhost:3000/health 접속 확인
```

---

## API 키 전달 방식

MCP URL에 쿼리파라미터로 전달:
```
https://your-server.railway.app/mcp?key=YOUR_VWORLD_API_KEY
```

또는 환경변수로 설정:
```
VWORLD_API_KEY=YOUR_VWORLD_API_KEY
```
