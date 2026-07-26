import { BrandMark } from "./BrandMark";
import "../styles/login.css";

/**
 * 세션 복원 중(checking) 화면. 로고 마크만 화면 중앙에 잠깐 보인다 — mock 은
 * 150ms 안팎이라 스피너/문구가 붙으면 오히려 과하다(Apple 의 "스피너 남발
 * 금지"를 문자 그대로 지키는 자리). RequireAuth 와 LoginScreen 둘 다 이
 * 컴포넌트를 쓴다 — /login 직접 방문 시에도 checking 동안은 로그인 폼도
 * 앱도 보여주지 않는다.
 */
export function BootSplash() {
  return (
    <div className="mr-boot-splash" role="status" aria-label="세션을 확인하는 중">
      <BrandMark size={56} />
    </div>
  );
}
