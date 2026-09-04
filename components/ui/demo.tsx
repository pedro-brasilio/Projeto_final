import Component from "./gradient-bars-background";

const settings = {
  numBars: 17,
  gradientColor: "#6050DC",
};

export default function Demo(props: Partial<typeof settings>) {
  const s = { ...settings, ...props };
  return (
    <div className="h-screen w-screen">
      <Component numBars={s.numBars} gradientFrom={s.gradientColor} />
    </div>
  );
}
