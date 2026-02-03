/* eslint-disable */
import React, { useState } from 'react';
import { Button, Input, Textarea, Select, SelectItem, Checkbox, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from '@heroui/react';
import { FlagIcon, ClipboardDocumentIcon } from '@heroicons/react/24/outline';
import { apiClientStore } from '../../../stores/apiClientStore';

interface BugReportFormProps {
  conversationId?: string;
  isOpen: boolean;
  onClose: () => void;
  // Function to gather the debug bundle (telemetry, API traces, etc.)
  getDebugBundle?: () => Record<string, any>;
}

export const BugReportForm: React.FC<BugReportFormProps> = ({
  conversationId,
  isOpen,
  onClose,
  getDebugBundle,
}) => {
  const [loading, setLoading] = useState(false);
  const [successId, setSuccessId] = useState<string | null>(null);

  // Form State
  const [severity, setSeverity] = useState<string>('medium');
  const [type, setType] = useState<string>('routing');
  const [title, setTitle] = useState('');
  const [expected, setExpected] = useState('');
  const [actual, setActual] = useState('');
  const [reproSteps, setReproSteps] = useState('');
  const [personaTestId, setPersonaTestId] = useState('');
  const [includeBundle, setIncludeBundle] = useState(true);
  const [screenshots, setScreenshots] = useState<string[]>([]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      if (file.size > 5 * 1024 * 1024) {
        alert('File too large (max 5MB)');
        return;
      }

      const reader = new FileReader();
      reader.onload = (ev) => {
        if (ev.target?.result) {
          setScreenshots(prev => [...prev, ev.target!.result as string]);
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const removeScreenshot = (index: number) => {
    setScreenshots(prev => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async () => {
    if (!title || !expected || !actual) return; // Simple validation

    setLoading(true);
    try {
      const bundle = (includeBundle && getDebugBundle) ? getDebugBundle() : {};

      const payload = {
        conversationId,
        severity,
        type,
        title,
        expected,
        actual,
        reproSteps,
        personaTestId,
        debugBundle: bundle,
        environment: 'local', // In a real app, inject this via config
        tags: [],
        screenshots,
      };

      const res = await apiClientStore.fetch('/api/v1/qa/bug-reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).then((r) => r.json());

      if (res.ok && res.report?.id) {
        setSuccessId(res.report.id);
      } else {
        alert(`Failed to submit report: ${JSON.stringify(res.error)}`);
      }
    } catch (err) {
      console.error(err);
      alert('Error submitting report');
    } finally {
      setLoading(false);
    }
  };

  const handleCopyId = () => {
    if (successId) {
      navigator.clipboard.writeText(successId);
    }
  };

  const resetForm = () => {
    setSuccessId(null);
    setTitle('');
    setExpected('');
    setActual('');
    setReproSteps('');
    setPersonaTestId('');
    setScreenshots([]);
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={resetForm} size="2xl" scrollBehavior="inside">
      <ModalContent>
        {successId ? (
          <>
            <ModalHeader className="flex gap-2 items-center text-green-600">
              <FlagIcon className="w-6 h-6" />
              Bug Reported Successfully!
            </ModalHeader>
            <ModalBody>
              <div className="p-6 bg-green-50 rounded-xl border border-green-100 text-center">
                <p className="text-gray-600 mb-2">Bug Report ID</p>
                <div className="text-3xl font-mono font-bold text-gray-800 mb-4">{successId}</div>
                <Button
                  startContent={<ClipboardDocumentIcon className="w-4 h-4" />}
                  variant="flat"
                  onPress={handleCopyId}
                >
                  Copy ID
                </Button>
              </div>
            </ModalBody>
            <ModalFooter>
              <Button color="primary" onPress={resetForm}>
                Done
              </Button>
            </ModalFooter>
          </>
        ) : (
          <>
            <ModalHeader className="flex gap-2 items-center text-red-600">
              <FlagIcon className="w-5 h-5" />
              Report a Bug
            </ModalHeader>
            <ModalBody className="gap-4">
              <div className="grid grid-cols-2 gap-4">
                <Select label="Type" selectedKeys={[type]} onChange={(e) => setType(e.target.value)}>
                  <SelectItem key="routing">Routing / Wrong Flow</SelectItem>
                  <SelectItem key="tool">Tool/API Mismatch</SelectItem>
                  <SelectItem key="copy">Copy/UX Confusing</SelectItem>
                  <SelectItem key="telemetry">Telemetry Mismatch</SelectItem>
                  <SelectItem key="extraction">Extraction/Memory Bug</SelectItem>
                  <SelectItem key="other">Other</SelectItem>
                </Select>

                <Select label="Severity" selectedKeys={[severity]} onChange={(e) => setSeverity(e.target.value)}>
                  <SelectItem key="critical" className="text-red-600">Critical (Blocker)</SelectItem>
                  <SelectItem key="high" className="text-orange-600">High (Wrong Outcome)</SelectItem>
                  <SelectItem key="medium" className="text-yellow-600">Medium (Friction)</SelectItem>
                  <SelectItem key="low" className="text-green-600">Low (Cosmetic)</SelectItem>
                </Select>
              </div>

              <Input
                label="Title"
                placeholder="Short description of the bug"
                isRequired
                value={title}
                onValueChange={setTitle}
              />

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Textarea
                  label="What you expected"
                  placeholder="I expected the agent to ask for..."
                  isRequired
                  minRows={3}
                  value={expected}
                  onValueChange={setExpected}
                />
                <Textarea
                  label="What happened instead"
                  placeholder="Instead, it skipped to step X..."
                  isRequired
                  minRows={3}
                  value={actual}
                  onValueChange={setActual}
                />
              </div>

              <Textarea
                label="Reproduction Steps (Optional)"
                placeholder="1. Start as Persona 2 &#10;2. Say 'Hello'..."
                minRows={2}
                value={reproSteps}
                onValueChange={setReproSteps}
              />

              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium text-gray-700">Screenshots</label>
                  <label className="cursor-pointer text-primary-600 text-sm hover:underline">
                    + Add Image
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={handleFileSelect}
                    />
                  </label>
                </div>
                <div className="flex gap-2 flex-wrap min-h-[40px] p-2 border rounded-xl border-dashed border-gray-300 bg-gray-50/50">
                  {screenshots.length === 0 && (
                    <div className="text-gray-400 text-xs w-full text-center py-2 self-center">
                      No screenshots attached
                    </div>
                  )}
                  {screenshots.map((src, idx) => (
                    <div key={idx} className="relative group w-20 h-20 border rounded-lg overflow-hidden bg-white shadow-sm">
                      <img src={src} className="w-full h-full object-cover" alt="screenshot" />
                      <button
                        onClick={() => removeScreenshot(idx)}
                        className="absolute top-1 right-1 bg-black/50 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex gap-4">
                <Input
                  label="Persona / Test Case ID"
                  placeholder="e.g. Persona 2 / B1"
                  className="flex-1"
                  value={personaTestId}
                  onValueChange={setPersonaTestId}
                />
                <div className="flex items-center gap-2 px-4 border rounded-xl border-gray-200 bg-gray-50 flex-1">
                  <Checkbox isSelected={includeBundle} onValueChange={setIncludeBundle}>
                    Include Debug Bundle
                  </Checkbox>
                  <span className="text-xs text-gray-500">(Telemetry, Logs, Tools)</span>
                </div>
              </div>
            </ModalBody>
            <ModalFooter>
              <Button variant="light" onPress={onClose}>
                Cancel
              </Button>
              <Button
                color="danger"
                onPress={handleSubmit}
                isLoading={loading}
                isDisabled={!title || !expected || !actual}
              >
                Submit Report
              </Button>
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  );
};
