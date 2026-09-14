"use client";

import type { ReactNode } from "react";
import { Button, Modal } from "@heroui/react";
import { X } from "lucide-react";

type ResourceModalSize = "compact" | "standard" | "wide" | "workflow";

type ResourceModalProps = {
  isOpen: boolean;
  title: string;
  description?: string;
  headerIcon?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: ResourceModalSize;
  onOpenChange: (open: boolean) => void;
};

export function ResourceModal({
  isOpen,
  title,
  description,
  headerIcon,
  children,
  footer,
  size = "standard",
  onOpenChange,
}: ResourceModalProps) {
  return (
    <Modal isOpen={isOpen} onOpenChange={onOpenChange}>
      <Modal.Backdrop variant="opaque" className="resource-modal-backdrop">
        <Modal.Container scroll="inside">
          <Modal.Dialog className={`resource-modal-dialog resource-modal-dialog-${size}`}>
            <Modal.Header className={`resource-modal-header ${headerIcon ? "resource-modal-header-with-icon" : ""}`}>
              {headerIcon ? <Modal.Icon className="resource-modal-icon">{headerIcon}</Modal.Icon> : null}
              <div>
                <Modal.Heading>{title}</Modal.Heading>
                {description ? <p>{description}</p> : null}
              </div>
              <Modal.CloseTrigger aria-label="关闭">
                <X size={18} />
              </Modal.CloseTrigger>
            </Modal.Header>
            <Modal.Body className="resource-modal-body">{children}</Modal.Body>
            {footer ? <Modal.Footer className="resource-modal-footer">{footer}</Modal.Footer> : null}
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}

export function ModalCancelButton({ onPress }: { onPress: () => void }) {
  return (
    <Button type="button" variant="secondary" onPress={onPress}>
      取消
    </Button>
  );
}
