"use client";

import { useMemo, useState } from "react";
import styles from "@/styles/components/dashboard/dashboardChart.module.css";

const HOUR_MS = 60 * 60 * 1000;
const PERIODS = [
  { value: "30d", label: "30 jours", days: 30 },
  { value: "15d", label: "15 jours", days: 15 },
  { value: "7d", label: "7 jours", days: 7 },
  { value: "24h", label: "24 h", hours: 24 },
];

function getAvailability(checks) {
  if (checks.length === 0) return null;

  const successful = checks.filter((check) =>
    ["up", "online", "ok", "success"].includes(
      String(check.status ?? "").toLowerCase(),
    ),
  ).length;

  return Math.round((successful / checks.length) * 1000) / 10;
}

function buildSeries(checks, period, now) {
  if (period === "24h") {
    const start = now - 24 * HOUR_MS;

    return Array.from({ length: 24 }, (_, index) => {
      const bucketStart = start + index * HOUR_MS;
      const bucketEnd = bucketStart + HOUR_MS;
      const bucketChecks = checks.filter((check) => {
        const timestamp = new Date(check.checked_at).getTime();

        return (
          Number.isFinite(timestamp) &&
          timestamp >= bucketStart &&
          timestamp < bucketEnd &&
          timestamp <= now
        );
      });

      return {
        date: new Date(bucketStart).toISOString(),
        label: new Intl.DateTimeFormat("fr-FR", {
          hour: "2-digit",
          minute: "2-digit",
        }).format(new Date(bucketStart)),
        availability: getAvailability(bucketChecks),
        total: bucketChecks.length,
      };
    });
  }

  const days = PERIODS.find((item) => item.value === period)?.days ?? 30;
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);

  return Array.from({ length: days }, (_, index) => {
    const bucketStart = new Date(today);
    bucketStart.setDate(today.getDate() - days + index + 1);

    const bucketEnd = new Date(bucketStart);
    bucketEnd.setDate(bucketEnd.getDate() + 1);

    const bucketChecks = checks.filter((check) => {
      const timestamp = new Date(check.checked_at).getTime();

      return (
        Number.isFinite(timestamp) &&
        timestamp >= bucketStart.getTime() &&
        timestamp < bucketEnd.getTime() &&
        timestamp <= now
      );
    });

    return {
      date: bucketStart.toISOString(),
      label: new Intl.DateTimeFormat("fr-FR", {
        day: "2-digit",
        month: "2-digit",
      }).format(bucketStart),
      availability: getAvailability(bucketChecks),
      total: bucketChecks.length,
    };
  });
}

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

export default function DashboardCharts({ checks = [] }) {
  const [period, setPeriod] = useState("30d");
  const data = useMemo(
    () => buildSeries(checks, period, Date.now()),
    [checks, period],
  );
  const chart = buildChart(data);
  const yLevels = [0, 25, 50, 75, 100];

  const linePaths = chart.segments.map((segment) =>
    segment
      .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`)
      .join(" "),
  );

  const labelCount = 5;
  const xLabels = Array.from({ length: labelCount }, (_, index) => {
    const dataIndex = Math.round(
      (index * (data.length - 1)) / (labelCount - 1),
    );

    return { index: dataIndex, item: data[dataIndex] };
  }).filter(
    ({ item }, index, labels) =>
      item && labels.findIndex((label) => label.item.date === item.date) === index,
  );

  const selectedPeriod = PERIODS.find((item) => item.value === period);

  return (
    <div className={styles.chart}>
      <div className={styles.chartToolbar}>
        <span className={styles.legend}>
          <span className={styles.legendDot} />
          Disponibilité
        </span>

        <div className={styles.periodSelector} aria-label="Période du graphique">
          {PERIODS.map((item) => (
            <button
              type="button"
              key={item.value}
              className={`${styles.periodButton} ${
                item.value === period ? styles.periodButtonActive : ""
              }`}
              aria-pressed={item.value === period}
              onClick={() => setPeriod(item.value)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.scroll}>
        <svg
          className={styles.svg}
          viewBox={`0 0 ${chart.width} ${chart.height}`}
          role="img"
          aria-label={`Disponibilité sur ${selectedPeriod.label}`}
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
