# 제주돌담체 미리 렌더링 이미지 (MIN-316)

칭호와 큰 숫자에 쓰는 제주돌담체를 **서체 파일 없이** 쓰기 위해 미리 그려 둔 흰색 PNG예요.
서체 파일(ttf/woff)은 레포에 넣지 않아요 (재배포 방지).

- 글자 크기 200px, 흰색(#FFFFFF), 투명 배경. 화면에서 색을 입혀 쓰고 크기를 줄여 그려요
- `glyphs.json`
  - `height` 197 / `baseline` 143 / `padX` 4 (이미지 좌우 여백)
  - `titles.{id}.lines` 카드용 2줄 칭호 (줄마다 이미지 한 장)
  - `titles.{id}.inline` 화면 목록용 한 줄 칭호
  - `digits` 0~9와 쉼표. 숫자는 `advance`만큼 옮기며 이어 붙여요
- 칭호 id: resident, mainPref, subPref, oneStage, early, late, watchTime, streak, headliner, rookie(그민페 신생아)
- 칭호 문구를 바꾸면 이미지를 다시 만들어야 해요 (검수 측에서 생성)
