/**
 * MolCube 로고 마크. 원래 App.tsx 안에 있던 것을 여기로 옮겨 App.tsx 와
 * 로그인 화면(LoginScreen/BootSplash)이 같은 SVG 를 공유하게 했다 —
 * 로고 자체(마크업·색)는 바꾸지 않았다. 로고의 민트/블루/앰버는 이
 * 마크 안에서만 허용된다(DESIGN.md §7 Don't: UI 색으로 풀지 않는다).
 */
export function BrandMark({ size = 20, className }: { size?: number; className?: string }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 100 100"
      aria-hidden="true"
    >
      <polygon points="50,6 90,28 50,50 10,28" fill="#73FEDD" stroke="#202362" strokeWidth="5" strokeLinejoin="round" />
      <polygon points="10,28 50,50 50,94 10,72" fill="#4279BC" stroke="#202362" strokeWidth="5" strokeLinejoin="round" />
      <polygon points="90,28 50,50 50,94 90,72" fill="#FFC006" stroke="#202362" strokeWidth="5" strokeLinejoin="round" />
    </svg>
  );
}
