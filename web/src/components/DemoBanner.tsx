// A thin banner shown only in the GitHub Pages demo build, so visitors know the
// data is simulated. Renders nothing in a normal build.
export default function DemoBanner() {
  if (import.meta.env.VITE_DEMO !== "1") return null;
  return (
    <div className="shrink-0 bg-ember text-[color:var(--on-ember)] text-center text-[12px] py-1.5 px-4">
      演示环境 · 数据为模拟数据，刷新即重置 · 登录账号 demo / 密码 demo
    </div>
  );
}
