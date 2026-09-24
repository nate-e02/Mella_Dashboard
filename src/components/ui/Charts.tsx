"use client";

import { memo, useId } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatCurrency } from "@/lib/format";

const gridColor = "#1e2330";
const mutedColor = "#8b92a4";
const tooltipStyle = { background: "#0d1017", border: "1px solid #1e2330", borderRadius: 8, fontSize: 12 };

export const RevenueAreaChart = memo(function RevenueAreaChart({ data, currency = "ETB" }: { data: { date: string; revenue: number }[]; currency?: string }) {
  const gradientId = useId();
  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart data={data} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#6d5ef8" stopOpacity={0.5} />
            <stop offset="100%" stopColor="#6d5ef8" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={gridColor} vertical={false} />
        <XAxis dataKey="date" tick={{ fill: mutedColor, fontSize: 11 }} tickLine={false} axisLine={{ stroke: gridColor }} minTickGap={30} />
        <YAxis tick={{ fill: mutedColor, fontSize: 11 }} tickLine={false} axisLine={false} width={60} />
        <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: "#e7e9ee" }} formatter={(value) => [formatCurrency(Number(value), currency), "Revenue"]} />
        <Area type="monotone" dataKey="revenue" stroke="#6d5ef8" fill={`url(#${gradientId})`} strokeWidth={2} />
      </AreaChart>
    </ResponsiveContainer>
  );
});

export const SignupBarChart = memo(function SignupBarChart({ data }: { data: { date: string; signups: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
        <CartesianGrid stroke={gridColor} vertical={false} />
        <XAxis dataKey="date" tick={{ fill: mutedColor, fontSize: 11 }} tickLine={false} axisLine={{ stroke: gridColor }} minTickGap={30} />
        <YAxis tick={{ fill: mutedColor, fontSize: 11 }} tickLine={false} axisLine={false} width={30} allowDecimals={false} />
        <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: "#e7e9ee" }} />
        <Bar dataKey="signups" fill="#3b82f6" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
});

export const EquityCurveChart = memo(function EquityCurveChart({ data, currency = "ETB" }: { data: { date: string; equity: number }[]; currency?: string }) {
  const gradientId = useId();
  return (
    <ResponsiveContainer width="100%" height={260}>
      <AreaChart data={data} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#22c55e" stopOpacity={0.4} />
            <stop offset="100%" stopColor="#22c55e" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={gridColor} vertical={false} />
        <XAxis dataKey="date" tick={{ fill: mutedColor, fontSize: 11 }} tickLine={false} axisLine={{ stroke: gridColor }} minTickGap={30} />
        <YAxis tick={{ fill: mutedColor, fontSize: 11 }} tickLine={false} axisLine={false} width={70} domain={["auto", "auto"]} />
        <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: "#e7e9ee" }} formatter={(value) => [formatCurrency(Number(value), currency), "Equity"]} />
        <Area type="monotone" dataKey="equity" stroke="#22c55e" fill={`url(#${gradientId})`} strokeWidth={2} />
      </AreaChart>
    </ResponsiveContainer>
  );
});
