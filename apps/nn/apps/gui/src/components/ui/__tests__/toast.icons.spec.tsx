import { render } from "@testing-library/react";
import React from "react";
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { Toast } from "../Toast";

const failOnConsoleError = () => {
  const orig = console.error;
  console.error = (...args: any[]) => {
    const msg = String(args[0] ?? "");
    if (msg.match(/invalid element type/i)) {
      throw new Error("React invalid element type detected - Toast icon undefined!");
    }
    orig.apply(console, args);
  };
  return () => (console.error = orig);
};

describe("Toast icons are crash-proof", () => {
  let restore: () => void;

  beforeEach(() => {
    restore = failOnConsoleError();
  });

  afterEach(() => {
    restore?.();
    vi.resetModules();
  });

  it("renders all variants even if a lucide icon is undefined", async () => {
    // Mock lucide-react with X undefined to simulate rename/tree-shake issue
    vi.doMock("lucide-react", () => ({
      X: undefined, // simulate the exact bug we hit
      Info: (props: any) => <svg data-testid="info-icon" {...props} />,
      AlertCircle: (props: any) => <svg data-testid="alert-icon" {...props} />,
      TriangleAlert: (props: any) => <svg data-testid="triangle-icon" {...props} />,
      CircleCheck: (props: any) => <svg data-testid="check-icon" {...props} />
    }));

    // Reload module with mocked lucide
    const { Toast: T } = await import("../Toast");
    
    const variants = ["default", "success", "warning", "destructive"] as const;
    
    for (const variant of variants) {
      const { getByRole, unmount } = render(
        <T 
          id="test-toast" 
          title="Test Toast" 
          description="Test description"
          variant={variant} 
          onClose={() => {}} 
        />
      );
      
      // Should still render without crashing even with undefined X icon
      expect(getByRole("button", { name: /close/i })).toBeInTheDocument();
      unmount();
    }
  });

  it("renders with all icons defined correctly", () => {
    const { getByRole, getByTestId } = render(
      <Toast 
        id="test" 
        title="Success!" 
        description="Operation completed"
        variant="success" 
        onClose={() => {}} 
      />
    );
    
    // Close button should exist
    expect(getByRole("button", { name: /close/i })).toBeInTheDocument();
    
    // Success icon should be rendered
    const toastElement = getByRole("alert");
    expect(toastElement).toBeInTheDocument();
  });

  it("SafeIcon fallback prevents crashes", async () => {
    // Mock with ALL icons undefined
    vi.doMock("lucide-react", () => ({
      X: undefined,
      Info: undefined,
      AlertCircle: undefined,
      TriangleAlert: undefined,
      CircleCheck: undefined
    }));

    const { Toast: T } = await import("../Toast");
    
    // Should not throw even with all icons undefined
    const { container } = render(
      <T 
        id="fallback-test" 
        title="Fallback Test" 
        variant="success" 
        onClose={() => {}} 
      />
    );
    
    // Should render something without crashing
    expect(container.firstChild).toBeInTheDocument();
  });
});