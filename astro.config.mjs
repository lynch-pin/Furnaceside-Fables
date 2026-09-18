// @ts-check
import { defineConfig } from 'astro/config';

// https://docs.astro.build/en/reference/configuration-reference/
export default defineConfig({
  // GitHub Pages 정적 배포
  output: 'static',

  // TODO(site): 커스텀 도메인 확정 후 주석 해제.
  //   예정 도메인: https://fables.lone-trail.com
  //   site 를 설정하면 sitemap / canonical URL / Astro.site 가 동작한다.
  //   GitHub Pages 의 <user>.github.io/<repo> 형태로 배포할 경우에는 base: '/<repo>' 도 함께 설정.
  // site: 'https://fables.lone-trail.com',

  // 링크 끝 슬래시 정책 (GitHub Pages 는 디렉터리 index.html 을 서빙하므로 'ignore' 가 무난)
  trailingSlash: 'ignore',

  build: {
    // /story/xxx/index.html 형태로 출력 (GitHub Pages 기본 라우팅과 호환)
    format: 'directory',
  },

  vite: {
    // 빌드 시 gamedata/ 원본을 fs 로 읽기 때문에 Vite 가 감시하지 않도록 제외
    server: {
      watch: {
        ignored: ['**/gamedata/**'],
      },
    },
  },
});
