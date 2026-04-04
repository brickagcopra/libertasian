'use client';

import Link from 'next/link';
import { useCallback, useMemo, useState } from 'react';

import { useTasks } from '@/features/workspace/hooks/use-tasks';
import { ROUTES } from '@/lib/constants';
import type { TaskListItem } from '@/features/workspace/types';

const PRIORITY_COLORS: Record<string, string> = {
  urgent: 'border-l-red-500',
  high: 'border-l-orange-500',
  medium: 'border-l-yellow-500',
  low: 'border-l-gray-400',
};

const STATUS_DOT: Record<string, string> = {
  todo: 'bg-gray-400',
  in_progress: 'bg-blue-500',
  done: 'bg-green-500',
  cancelled: 'bg-red-400',
};

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function getMonthDays(year: number, month: number) {
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  return { firstDay, daysInMonth };
}

function formatDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function isToday(year: number, month: number, day: number) {
  const today = new Date();
  return today.getFullYear() === year && today.getMonth() === month && today.getDate() === day;
}

export default function CalendarPage() {
  const today = new Date();
  const [currentYear, setCurrentYear] = useState(today.getFullYear());
  const [currentMonth, setCurrentMonth] = useState(today.getMonth());

  // Fetch tasks with due dates in the current month range (with buffer)
  const monthStart = new Date(currentYear, currentMonth, 1);
  const monthEnd = new Date(currentYear, currentMonth + 1, 0, 23, 59, 59);

  const { data, isLoading } = useTasks({
    dueAfter: monthStart.toISOString(),
    dueBefore: monthEnd.toISOString(),
    limit: 100,
  });

  const tasks = data?.data ?? [];

  // Group tasks by date
  const tasksByDate = useMemo(() => {
    const map: Record<string, TaskListItem[]> = {};
    for (const task of tasks) {
      if (task.dueDate) {
        const key = formatDateKey(new Date(task.dueDate));
        if (!map[key]) map[key] = [];
        map[key].push(task);
      }
    }
    return map;
  }, [tasks]);

  const { firstDay, daysInMonth } = getMonthDays(currentYear, currentMonth);

  const goToPrevMonth = useCallback(() => {
    if (currentMonth === 0) {
      setCurrentYear((y) => y - 1);
      setCurrentMonth(11);
    } else {
      setCurrentMonth((m) => m - 1);
    }
  }, [currentMonth]);

  const goToNextMonth = useCallback(() => {
    if (currentMonth === 11) {
      setCurrentYear((y) => y + 1);
      setCurrentMonth(0);
    } else {
      setCurrentMonth((m) => m + 1);
    }
  }, [currentMonth]);

  const goToToday = useCallback(() => {
    const now = new Date();
    setCurrentYear(now.getFullYear());
    setCurrentMonth(now.getMonth());
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Calendar</h1>
          <p className="mt-1 text-sm text-gray-500">Task deadlines and due dates</p>
        </div>
        <Link
          href={ROUTES.WORKSPACE_TASKS}
          className="rounded-md border px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Task List
        </Link>
      </div>

      {/* Month navigation */}
      <div className="flex items-center justify-between rounded-lg border bg-white p-4">
        <button
          onClick={goToPrevMonth}
          className="rounded-md border px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Previous
        </button>
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold">
            {MONTHS[currentMonth]} {currentYear}
          </h2>
          <button
            onClick={goToToday}
            className="rounded-md border px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50"
          >
            Today
          </button>
        </div>
        <button
          onClick={goToNextMonth}
          className="rounded-md border px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Next
        </button>
      </div>

      {/* Calendar grid */}
      <div className="overflow-hidden rounded-lg border bg-white">
        {/* Weekday headers */}
        <div className="grid grid-cols-7 border-b bg-gray-50">
          {WEEKDAYS.map((day) => (
            <div key={day} className="px-2 py-2 text-center text-xs font-semibold uppercase tracking-wider text-gray-500">
              {day}
            </div>
          ))}
        </div>

        {/* Day cells */}
        <div className="grid grid-cols-7">
          {/* Empty cells for days before first of month */}
          {Array.from({ length: firstDay }).map((_, i) => (
            <div key={`empty-${i}`} className="min-h-[100px] border-b border-r bg-gray-50 p-1" />
          ))}

          {/* Day cells */}
          {Array.from({ length: daysInMonth }).map((_, i) => {
            const day = i + 1;
            const dateKey = formatDateKey(new Date(currentYear, currentMonth, day));
            const dayTasks = tasksByDate[dateKey] ?? [];
            const todayClass = isToday(currentYear, currentMonth, day);

            return (
              <div
                key={day}
                className={`min-h-[100px] border-b border-r p-1 ${todayClass ? 'bg-blue-50' : ''}`}
              >
                <div className={`mb-1 text-right text-xs font-medium ${todayClass ? 'text-blue-600' : 'text-gray-500'}`}>
                  {day}
                </div>
                <div className="space-y-0.5">
                  {dayTasks.slice(0, 3).map((task) => (
                    <Link
                      key={task.id}
                      href={ROUTES.WORKSPACE_TASK(task.id)}
                      className={`block truncate rounded border-l-2 bg-white px-1.5 py-0.5 text-[11px] leading-tight hover:bg-gray-50 ${PRIORITY_COLORS[task.priority] ?? PRIORITY_COLORS['medium']}`}
                      title={task.title}
                    >
                      <span className={`mr-1 inline-block h-1.5 w-1.5 rounded-full ${STATUS_DOT[task.status] ?? STATUS_DOT['todo']}`} />
                      {task.title}
                    </Link>
                  ))}
                  {dayTasks.length > 3 && (
                    <span className="block px-1.5 text-[10px] text-gray-500">
                      +{dayTasks.length - 3} more
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Upcoming tasks summary */}
      {!isLoading && tasks.length > 0 && (
        <div className="rounded-lg border bg-white p-4">
          <h3 className="mb-3 text-sm font-semibold text-gray-700">
            Tasks this month ({tasks.length})
          </h3>
          <div className="space-y-2">
            {tasks
              .sort((a, b) => {
                const da = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
                const db = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
                return da - db;
              })
              .slice(0, 10)
              .map((task) => (
                <div key={task.id} className="flex items-center gap-3 text-sm">
                  <span className={`h-2 w-2 flex-shrink-0 rounded-full ${STATUS_DOT[task.status] ?? STATUS_DOT['todo']}`} />
                  <Link href={ROUTES.WORKSPACE_TASK(task.id)} className="flex-1 truncate hover:underline">
                    {task.title}
                  </Link>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${PRIORITY_COLORS[task.priority]?.replace('border-l-', 'bg-').replace('-500', '-100') ?? 'bg-gray-100'} text-gray-700`}>
                    {task.priority}
                  </span>
                  <span className="flex-shrink-0 text-xs text-gray-500">
                    {task.dueDate ? new Date(task.dueDate).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' }) : ''}
                  </span>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
