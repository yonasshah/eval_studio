import { useEffect, useState } from 'react';
import { Modal, Stack, Text, Textarea, Button, Group } from '@mantine/core';
import type { ReviewStatus } from './types';
import { STATUS_META } from './types';
import { extractInvitedExtra, INVITED_DEFAULT_NOTE } from './statusChange';

export interface CommentModalRequest {
  status: ReviewStatus;
  applicantLabel: string;
  existingComment?: string | null;
  // Called with the raw text the reviewer typed: for 'invited' this is
  // just their additional notes (the backend prepends "MIR; "); for
  // 'not_invited' this is the full required justification.
  apply: (comment: string) => void;
}

interface Props {
  request: CommentModalRequest | null;
  onClose: () => void;
}

export default function StatusCommentModal({ request, onClose }: Props) {
  const [text, setText] = useState('');

  useEffect(() => {
    if (!request) return;
    if (request.status === 'invited') {
      setText(extractInvitedExtra(request.existingComment));
    } else {
      setText(request.existingComment?.trim() ?? '');
    }
  }, [request]);

  if (!request) return null;

  const { status, applicantLabel, apply } = request;
  const isNotInvited = status === 'not_invited';
  const trimmed = text.trim();
  const canConfirm = !isNotInvited || trimmed.length > 0;
  const statusMeta = STATUS_META[status];

  function handleConfirm() {
    apply(text.trim());
    onClose();
  }

  return (
    <Modal opened onClose={onClose} title={`Mark ${statusMeta.label}`} centered>
      <Stack gap="sm">
        <Text size="sm" c="dimmed">
          {applicantLabel}
        </Text>

        {status === 'invited' && (
          <Text size="sm">
            A note reading <strong>"{INVITED_DEFAULT_NOTE}"</strong> will be recorded
            automatically and included in the export. You can add additional comments below
            (optional).
          </Text>
        )}
        {isNotInvited && (
          <Text size="sm">
            A comment is required to justify not inviting this applicant. This will be included
            in the export.
          </Text>
        )}

        <Textarea
          placeholder={
            isNotInvited ? 'Reason applicant was not invited...' : 'Additional comments (optional)...'
          }
          value={text}
          onChange={(e) => setText(e.currentTarget.value)}
          minRows={3}
          autosize
          data-autofocus
        />

        <Group justify="flex-end" gap="xs">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button color={statusMeta.color} disabled={!canConfirm} onClick={handleConfirm}>
            Confirm
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}