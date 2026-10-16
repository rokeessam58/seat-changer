# 우리반 자리 바꾸기

서버 없이 브라우저에서만 동작하는 학급 자리 배치 웹앱입니다. (GitHub Pages 배포용)

## 배포
1. 이 폴더 전체를 GitHub 저장소에 올립니다. (`index.html`, `app.js`, `style.css`, `vendor/`)
2. 저장소 **Settings → Pages → Branch: main / (root)** 로 지정합니다.
3. `https://<계정>.github.io/<저장소>/` 로 접속합니다.

## 데이터 저장
- 모든 설정·임시 슬롯·확정 자리는 브라우저(localStorage)에 자동 저장됩니다.
- 브라우저/PC를 옮길 때는 상단 **저장 파일 받기/불러오기**(JSON)를 사용하세요.
- 엑셀 양식은 앱의 **엑셀 양식 받기** 버튼으로 받을 수 있습니다.
