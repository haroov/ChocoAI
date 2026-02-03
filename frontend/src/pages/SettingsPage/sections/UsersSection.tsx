/* eslint-disable */
import React, { useEffect, useState } from 'react';
import {
  Table,
  TableHeader,
  TableColumn,
  TableBody,
  TableRow,
  TableCell,
  Button,
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Input,
  useDisclosure,
  Chip,
  Tooltip,
} from '@heroui/react';
import { PlusIcon, TrashIcon, KeyIcon } from '@heroicons/react/24/outline';
import moment from 'moment';
import { apiClientStore } from '../../../stores/apiClientStore';
import { SectionHeader } from '../components/SectionHeader';
import { SectionContent } from '../components/SectionContent';

type AdminUser = {
  id: string;
  username: string;
  role: string;
  lastLoginAt: string | null;
  createdAt: string;
};

export const UsersSection: React.FC = () => {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Modals state
  const createUserModal = useDisclosure();
  const resetPasswordModal = useDisclosure();
  const deleteUserModal = useDisclosure();

  const [selectedUser, setSelectedUser] = useState<AdminUser | null>(null);
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [resetPasswordValue, setResetPasswordValue] = useState('');

  const fetchUsers = async () => {
    setIsLoading(true);
    try {
      const res = await apiClientStore.fetch('/api/v1/admin/users');
      if (res.ok) {
        const data = await res.json();
        setUsers(data.users || []);
      }
    } catch (error) {
      console.error('Failed to fetch users', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const handleCreateUser = async () => {
    try {
      const res = await apiClientStore.fetch('/api/v1/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: newUsername, password: newPassword }),
      });
      if (res.ok) {
        fetchUsers();
        createUserModal.onClose();
        setNewUsername('');
        setNewPassword('');
      } else {
        const err = await res.json();
        alert(err.error || 'Failed to create user');
      }
    } catch (e) {
      console.error(e);
      alert('Error creating user');
    }
  };

  const handleResetPassword = async () => {
    if (!selectedUser) return;
    try {
      const res = await apiClientStore.fetch(`/api/v1/admin/users/${selectedUser.id}/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newPassword: resetPasswordValue }),
      });
      if (res.ok) {
        resetPasswordModal.onClose();
        setResetPasswordValue('');
        alert('Password reset successfully');
      } else {
        const err = await res.json();
        alert(err.error || 'Failed to reset password');
      }
    } catch (e) {
      console.error(e);
      alert('Error resetting password');
    }
  };

  const handleDeleteUser = async () => {
    if (!selectedUser) return;
    if (!confirm(`Are you sure you want to delete ${selectedUser.username}?`)) return; // Double confirmation

    try {
      const res = await apiClientStore.fetch(`/api/v1/admin/users/${selectedUser.id}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        fetchUsers();
        deleteUserModal.onClose();
      } else {
        const err = await res.json();
        alert(err.error || 'Failed to delete user');
      }
    } catch (e) {
      console.error(e);
      alert('Error deleting user');
    }
  };

  // Prepare open handlers
  const openResetPassword = (user: AdminUser) => {
    setSelectedUser(user);
    setResetPasswordValue('');
    resetPasswordModal.onOpen();
  };

  const openDeleteUser = (user: AdminUser) => {
    setSelectedUser(user);
    deleteUserModal.onOpen();
  };

  const columns = [
    { name: 'USERNAME', uid: 'username' },
    { name: 'ROLE', uid: 'role' },
    { name: 'LAST LOGIN', uid: 'lastLoginAt' },
    { name: 'CREATED', uid: 'createdAt' },
    { name: 'ACTIONS', uid: 'actions' },
  ];

  const renderCell = React.useCallback((user: AdminUser, columnKey: React.Key) => {
    const cellValue = user[columnKey as keyof AdminUser];

    switch (columnKey) {
      case 'role':
        return (
          <Chip color={cellValue === 'admin' ? 'primary' : 'default'} size="sm" variant="flat">
            {String(cellValue).toUpperCase()}
          </Chip>
        );
      case 'lastLoginAt':
        return user.lastLoginAt ? moment(user.lastLoginAt).fromNow() : 'Never';
      case 'createdAt':
        return moment(user.createdAt).format('LL');
      case 'actions':
        return (
          <div className="relative flex items-center gap-2">
            <Tooltip content="Reset Password">
              <span
                className="text-lg text-default-400 cursor-pointer active:opacity-50"
                onClick={() => openResetPassword(user)}
              >
                <KeyIcon className="w-4 h-4" />
              </span>
            </Tooltip>
            <Tooltip color="danger" content="Delete User">
              <span
                className="text-lg text-danger cursor-pointer active:opacity-50"
                onClick={() => openDeleteUser(user)}
              >
                <TrashIcon className="w-4 h-4" />
              </span>
            </Tooltip>
          </div>
        );
      default:
        return cellValue;
    }
  }, []);

  return (
    <div>
      <SectionHeader title="User Management" />
      <SectionContent>
        <div className="flex justify-end mb-4">
          <Button color="primary" endContent={<PlusIcon className="w-4 h-4" />} onPress={createUserModal.onOpen}>
            Add User
          </Button>
        </div>

        <Table aria-label="Users table">
          <TableHeader columns={columns}>
            {(column) => (
              <TableColumn key={column.uid} align={column.uid === 'actions' ? 'end' : 'start'}>
                {column.name}
              </TableColumn>
            )}
          </TableHeader>
          <TableBody items={users} isLoading={isLoading} emptyContent="No users found">
            {(item) => (
              <TableRow key={item.id}>
                {(columnKey) => <TableCell>{renderCell(item, columnKey)}</TableCell>}
              </TableRow>
            )}
          </TableBody>
        </Table>

        {/* Create User Modal */}
        <Modal isOpen={createUserModal.isOpen} onOpenChange={createUserModal.onOpenChange}>
          <ModalContent>
            {(onClose) => (
              <>
                <ModalHeader className="flex flex-col gap-1">Create New User</ModalHeader>
                <ModalBody>
                  <Input
                    label="Username / Email"
                    placeholder="Enter email"
                    value={newUsername}
                    onValueChange={setNewUsername}
                    variant="bordered"
                  />
                  <Input
                    label="Password"
                    placeholder="Enter password"
                    type="password"
                    value={newPassword}
                    onValueChange={setNewPassword}
                    variant="bordered"
                  />
                </ModalBody>
                <ModalFooter>
                  <Button color="danger" variant="light" onPress={onClose}>
                    Cancel
                  </Button>
                  <Button color="primary" onPress={handleCreateUser}>
                    Create
                  </Button>
                </ModalFooter>
              </>
            )}
          </ModalContent>
        </Modal>

        {/* Reset Password Modal */}
        <Modal isOpen={resetPasswordModal.isOpen} onOpenChange={resetPasswordModal.onOpenChange}>
          <ModalContent>
            {(onClose) => (
              <>
                <ModalHeader className="flex flex-col gap-1">
                  Reset Password for
                  {selectedUser?.username}
                </ModalHeader>
                <ModalBody>
                  <Input
                    label="New Password"
                    placeholder="Enter new password"
                    type="password"
                    value={resetPasswordValue}
                    onValueChange={setResetPasswordValue}
                    variant="bordered"
                  />
                </ModalBody>
                <ModalFooter>
                  <Button color="danger" variant="light" onPress={onClose}>
                    Cancel
                  </Button>
                  <Button color="primary" onPress={handleResetPassword}>
                    Reset Password
                  </Button>
                </ModalFooter>
              </>
            )}
          </ModalContent>
        </Modal>

        {/* Delete Confirmation Modal */}
        <Modal isOpen={deleteUserModal.isOpen} onOpenChange={deleteUserModal.onOpenChange}>
          <ModalContent>
            {(onClose) => (
              <>
                <ModalHeader className="flex flex-col gap-1">Delete User</ModalHeader>
                <ModalBody>
                  <p>
                    Are you sure you want to delete
                    <strong>{selectedUser?.username}</strong>
                    ?
                  </p>
                  <p className="text-small text-default-500">This action cannot be undone.</p>
                </ModalBody>
                <ModalFooter>
                  <Button color="default" variant="light" onPress={onClose}>
                    Cancel
                  </Button>
                  <Button color="danger" onPress={handleDeleteUser}>
                    Delete
                  </Button>
                </ModalFooter>
              </>
            )}
          </ModalContent>
        </Modal>

      </SectionContent>
    </div>
  );
};
