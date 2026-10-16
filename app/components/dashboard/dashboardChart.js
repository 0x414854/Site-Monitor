import styles from "@/styles/components/dashboard/dashboardChart.module.css";

function buildChart(data) {
  const width = 760;
  const height = 250;
  const left = 42;
  const right = 14;
  const top = 20;
  const bottom = 34;

  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const step = data.length > 1 ? plotWidth / (data.length - 1) : 0;

  const points = data
    .map((item, index) => {
      if (item.availability === null || item.availability === undefined) {
        return null;
      }

      return {
        ...item,
        x: left + index * step,
        y: top + plotHeight * (1 - item.availability / 100),
        index,
      };
    })
    .filter(Boolean);

  const segments = [];
  let current = [];

  for (const point of points) {
    if (
      current.length > 0 &&
      point.index !== current[current.length - 1].index + 1
    ) {
      segments.push(current);
      current = [];
    }

    current.push(point);
  }

  if (current.length > 0) {
    segments.push(current);
  }

  return {
    width,
    height,
    left,
    right,
    top,
    bottom,
    plotWidth,
    plotHeight,
    step,
    points,
    segments,
  };
}

export default function DashboardCharts({ data = [] }) {
  const chart = buildChart(data);
  const yLevels = [0, 25, 50, 75, 100];

  const linePaths = chart.segments.map((segment) =>
    segment
      .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`)
      .join(" "),
  );

  const xLabels = [0, 7, 14, 21, 29]
    .map((index) => ({ index, item: data[index] }))
    .filter(({ item }) => item);

  return (
    <div className={styles.chart}>
      <div className={styles.legend}>
        <span className={styles.legendDot} />
        Disponibilité quotidienne
      </div>

      <div className={styles.scroll}>
        <svg
          className={styles.svg}
          viewBox={`0 0 ${chart.width} ${chart.height}`}
          role="img"
          aria-label="Disponibilité quotidienne sur 30 jours"
        >
          {yLevels.map((level) => {
            const y = chart.top + chart.plotHeight * (1 - level / 100);

            return (
              <g key={level}>
                <line
                  x1={chart.left}
                  x2={chart.width - chart.right}
                  y1={y}
                  y2={y}
                  className={styles.grid}
                />

                <text
                  x={chart.left - 10}
                  y={y + 4}
                  textAnchor="end"
                  className={styles.axis}
                >
                  {level}%
                </text>
              </g>
            );
          })}

          {data.map((item, index) => {
            const availability = item.availability;
            const hasData = availability !== null && availability !== undefined;

            if (!hasData) {
              return null;
            }

            const x = chart.left + index * chart.step;
            const barWidth = Math.max(2, chart.step * 0.55);
            const barHeight = chart.plotHeight * (availability / 100);
            const y = chart.top + chart.plotHeight - barHeight;

            return (
              <rect
                key={item.date ?? index}
                x={x - barWidth / 2}
                y={y}
                width={barWidth}
                height={barHeight}
                rx="2"
                className={styles.bar}
              >
                <title>
                  {`${item.label ?? item.date ?? "Date inconnue"} — ${availability}% — ${item.total ?? 0} contrôles`}
                </title>
              </rect>
            );
          })}

          {linePaths.map((path, index) => (
            <path key={index} d={path} className={styles.line} />
          ))}

          {chart.points.map((point) => (
            <circle
              key={point.date ?? point.index}
              cx={point.x}
              cy={point.y}
              r="3"
              className={styles.point}
            >
              <title>
                {`${point.label ?? point.date ?? "Date inconnue"} : ${point.availability}%`}
              </title>
            </circle>
          ))}

          {xLabels.map(({ index, item }) => (
            <text
              key={item.date ?? index}
              x={chart.left + index * chart.step}
              y={chart.height - 8}
              textAnchor="middle"
              className={styles.axis}
            >
              {item.label}
            </text>
          ))}
        </svg>
      </div>

      {chart.points.length === 0 && (
        <div className={styles.empty}>
          Aucune donnée disponible sur cette période.
        </div>
      )}
    </div>
  );
}
