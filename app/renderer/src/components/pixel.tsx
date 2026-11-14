/** Renders an 8x8 (or any size) character grid as crisp SVG rects; "." is transparent. */
export function pixelRects(rows: readonly string[], color: (c: string) => string): React.ReactNode[] {
  const rects: React.ReactNode[] = [];
  rows.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const c = row[x];
      if (c === ".") {
        x++;
        continue;
      }
      const start = x;
      while (x < row.length && row[x] === c) x++;
      rects.push(<rect key={`${y}:${start}`} x={start} y={y} width={x - start} height={1} fill={color(c)} />);
    }
  });
  return rects;
}
