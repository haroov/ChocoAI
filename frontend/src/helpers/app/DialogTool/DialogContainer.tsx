import React from 'react';
import { observer } from 'mobx-react-lite';
import dialogsStore from './dialogsStore';
import { DialogBase } from './DialogBase';

export const DialogContainer: React.FC = observer(() => dialogsStore.dialogs
  .map((dialogProps) => <DialogBase key={dialogProps.id} {...dialogProps} />));

DialogContainer.displayName = 'DialogContainer';
