/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useEffect, useState } from 'react';
import { Button, Chip } from '@heroui/react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeftIcon } from '@heroicons/react/24/solid';
import { apiClientStore } from '../../stores/apiClientStore';
import { useMainLayout } from '../../layouts/MainLayout';
import classNames from '../../helpers/classNames';
import { BugReportForm } from '../ConversationsPage/components/BugReportForm';

type BugReport = {
  id: string;
  conversationId: string;
  title: string;
  type: string;
  severity: string;
  status: string;
  createdAt: string;
  expected: string;
  actual: string;
  reproSteps: string;
};

export const BugReportsPage: React.FC = () => {
  useMainLayout({ title: 'QA Bug Reports' });
  const navigate = useNavigate();
  const [reports, setReports] = useState<BugReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await apiClientStore.fetch('/api/v1/qa/bug-reports').then((r) => r.json());
        if (res.ok) setReports(res.reports);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [isModalOpen]); // Reload when modal closes to see new bug

  const getSeverityColor = (s: string) => {
    switch (s) {
      case 'critical': return 'danger';
      case 'high': return 'warning';
      case 'medium': return 'primary';
      default: return 'default';
    }
  };

  return (
    <div className="p-6 max-w-[1200px] mx-auto min-h-screen bg-gray-50/50">
      <div className="mb-6 flex items-center gap-4">
        <Button isIconOnly variant="light" onPress={() => navigate('/qa')}>
          <ArrowLeftIcon className="size-5 text-gray-500" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Bug Reports</h1>
          <p className="text-gray-500 text-sm">Recent issues reported via the agent</p>
        </div>
        <div className="ml-auto">
          <Button color="danger" variant="flat" onPress={() => setIsModalOpen(true)}>
            Report General Bug
          </Button>
        </div>
      </div>

      <BugReportForm
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        conversationId={undefined}
      />

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-gray-500">Loading reports...</div>
        ) : reports.length === 0 ? (
          <div className="p-8 text-center text-gray-500">No bugs reported yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50 border-b border-gray-100 text-gray-500 font-medium">
                <tr>
                  <th className="p-4">Severity</th>
                  <th className="p-4">Type</th>
                  <th className="p-4">Title</th>
                  <th className="p-4">Status</th>
                  <th className="p-4">Reported</th>
                  <th className="p-4">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {reports.map((r) => (
                  <tr key={r.id} className="hover:bg-gray-50/50 transition-colors">
                    <td className="p-4">
                      <Chip size="sm" color={getSeverityColor(r.severity) as any} variant="flat" className="capitalize">
                        {r.severity}
                      </Chip>
                    </td>
                    <td className="p-4 text-gray-600 capitalize">{r.type}</td>
                    <td className="p-4 font-medium text-gray-900 max-w-xs truncate" title={r.title}>{r.title}</td>
                    <td className="p-4">
                      <span className={classNames(
                        'px-2 py-1 rounded text-xs font-semibold uppercase',
                        r.status === 'open' ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-600',
                      )}
                      >
                        {r.status}
                      </span>
                    </td>
                    <td className="p-4 text-gray-500">{new Date(r.createdAt).toLocaleString()}</td>
                    <td className="p-4">
                      {r.conversationId ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          color="primary"
                          onPress={() => navigate(`/conversations/${r.conversationId}`)}
                        >
                          View Chat
                        </Button>
                      ) : (
                        <span className="text-gray-400 text-xs italic">General Bug</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
