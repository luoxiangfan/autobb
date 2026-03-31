"use client"

import * as React from "react"
import { createPortal } from "react-dom"
import { Slot } from "@radix-ui/react-slot"
import { cn } from "@/lib/utils"

const DropdownMenuContext = React.createContext<{
    open: boolean;
    setOpen: React.Dispatch<React.SetStateAction<boolean>>;
    containerRef: React.MutableRefObject<HTMLDivElement | null>;
    contentRef: React.MutableRefObject<HTMLDivElement | null>;
}>({
    open: false,
    setOpen: () => { },
    containerRef: { current: null },
    contentRef: { current: null },
});

type DropdownMenuProps = {
    children: React.ReactNode;
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
}

const DropdownMenu = ({ children, open: controlledOpen, onOpenChange }: DropdownMenuProps) => {
    const [uncontrolledOpen, setUncontrolledOpen] = React.useState(false);
    const isControlled = typeof controlledOpen === "boolean";
    const open = isControlled ? Boolean(controlledOpen) : uncontrolledOpen;

    const setOpen = React.useCallback<React.Dispatch<React.SetStateAction<boolean>>>((value) => {
        const nextOpen = typeof value === "function"
            ? (value as (prevState: boolean) => boolean)(open)
            : value;

        if (!isControlled) {
            setUncontrolledOpen(nextOpen);
        }
        onOpenChange?.(nextOpen);
    }, [isControlled, onOpenChange, open]);

    const containerRef = React.useRef<HTMLDivElement>(null);
    const contentRef = React.useRef<HTMLDivElement>(null);

    React.useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            const target = event.target as Node;
            if (containerRef.current?.contains(target)) return;
            if (contentRef.current?.contains(target)) return;
            setOpen(false);
        };

        document.addEventListener("mousedown", handleClickOutside);
        return () => {
            document.removeEventListener("mousedown", handleClickOutside);
        };
    }, []);

    return (
        <DropdownMenuContext.Provider value={{ open, setOpen, containerRef, contentRef }}>
            <div className="relative inline-block text-left" ref={containerRef}>
                {children}
            </div>
        </DropdownMenuContext.Provider>
    );
};

const DropdownMenuTrigger = React.forwardRef<
    HTMLButtonElement,
    React.ButtonHTMLAttributes<HTMLButtonElement> & { asChild?: boolean }
>(({ className, children, asChild = false, ...props }, ref) => {
    const { open, setOpen } = React.useContext(DropdownMenuContext);
    const Comp = asChild ? Slot : "button"

    return (
        <Comp
            ref={ref}
            type={asChild ? undefined : "button"}
            onClick={() => setOpen(!open)}
            className={cn(className)}
            {...props}
        >
            {children}
        </Comp>
    );
});
DropdownMenuTrigger.displayName = "DropdownMenuTrigger";

const DropdownMenuContent = React.forwardRef<
    HTMLDivElement,
    React.HTMLAttributes<HTMLDivElement> & {
        align?: "start" | "end" | "center";
        side?: "top" | "bottom";
        sideOffset?: number;
    }
>(({ className, align = "center", side, sideOffset = 8, style, ...props }, forwardedRef) => {
    const { open, containerRef, contentRef } = React.useContext(DropdownMenuContext);
    const [layout, setLayout] = React.useState<{
        top: number;
        left: number;
        side: "top" | "bottom";
    } | null>(null);

    const syncPosition = React.useCallback(() => {
        const anchorEl = containerRef.current;
        const menuEl = contentRef.current;
        if (!anchorEl || !menuEl) return;

        const anchorRect = anchorEl.getBoundingClientRect();
        const menuRect = menuEl.getBoundingClientRect();
        const viewportPadding = 8;

        const spaceBelow = window.innerHeight - anchorRect.bottom - viewportPadding;
        const spaceAbove = anchorRect.top - viewportPadding;
        const resolvedSide = side
            ? side
            : (spaceBelow < menuRect.height && spaceAbove > spaceBelow ? "top" : "bottom");

        let top = resolvedSide === "top"
            ? anchorRect.top - menuRect.height - sideOffset
            : anchorRect.bottom + sideOffset;

        let left = 0;
        if (align === "start") {
            left = anchorRect.left;
        } else if (align === "end") {
            left = anchorRect.right - menuRect.width;
        } else {
            left = anchorRect.left + (anchorRect.width - menuRect.width) / 2;
        }

        left = Math.max(viewportPadding, Math.min(left, window.innerWidth - menuRect.width - viewportPadding));
        top = Math.max(viewportPadding, Math.min(top, window.innerHeight - menuRect.height - viewportPadding));

        setLayout({ top, left, side: resolvedSide });
    }, [align, containerRef, contentRef, side, sideOffset]);

    React.useLayoutEffect(() => {
        if (!open) {
            setLayout(null);
            return;
        }

        syncPosition();

        const handleViewportChange = () => {
            syncPosition();
        };

        window.addEventListener("resize", handleViewportChange);
        window.addEventListener("scroll", handleViewportChange, true);
        return () => {
            window.removeEventListener("resize", handleViewportChange);
            window.removeEventListener("scroll", handleViewportChange, true);
        };
    }, [open, syncPosition]);

    if (!open) return null;
    if (typeof document === "undefined") return null;

    const contentNode = (
        <div
            ref={(node) => {
                contentRef.current = node;
                if (typeof forwardedRef === "function") {
                    forwardedRef(node);
                } else if (forwardedRef) {
                    (forwardedRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
                }
            }}
            data-state={open ? "open" : "closed"}
            data-side={layout?.side || side || "bottom"}
            className={cn(
                "fixed z-[1000] min-w-[8rem] overflow-hidden rounded-md border bg-white p-1 text-gray-950 shadow-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
                className
            )}
            style={{
                top: layout?.top ?? -9999,
                left: layout?.left ?? -9999,
                visibility: layout ? "visible" : "hidden",
                ...style,
            }}
            {...props}
        />
    );

    return createPortal(contentNode, document.body);
});
DropdownMenuContent.displayName = "DropdownMenuContent";

const DropdownMenuItem = React.forwardRef<
    HTMLDivElement,
    React.HTMLAttributes<HTMLDivElement> & { inset?: boolean; disabled?: boolean }
>(({ className, inset, disabled, ...props }, ref) => {
    const { setOpen } = React.useContext(DropdownMenuContext);

    return (
        <div
            ref={ref}
            className={cn(
                "relative flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none transition-colors hover:bg-gray-100 focus:bg-gray-100 focus:text-gray-900 data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
                inset && "pl-8",
                className
            )}
            data-disabled={disabled ? "" : undefined}
            onClick={(e) => {
                if (disabled) {
                    e.preventDefault();
                    return;
                }
                setOpen(false);
                props.onClick?.(e);
            }}
            {...props}
        />
    );
});
DropdownMenuItem.displayName = "DropdownMenuItem";

const DropdownMenuLabel = React.forwardRef<
    HTMLDivElement,
    React.HTMLAttributes<HTMLDivElement> & { inset?: boolean }
>(({ className, inset, ...props }, ref) => (
    <div
        ref={ref}
        className={cn(
            "px-2 py-1.5 text-sm font-semibold",
            inset && "pl-8",
            className
        )}
        {...props}
    />
));
DropdownMenuLabel.displayName = "DropdownMenuLabel";

const DropdownMenuSeparator = React.forwardRef<
    HTMLDivElement,
    React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
    <div
        ref={ref}
        className={cn("-mx-1 my-1 h-px bg-gray-100", className)}
        {...props}
    />
));
DropdownMenuSeparator.displayName = "DropdownMenuSeparator";

export {
    DropdownMenu,
    DropdownMenuTrigger,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
};
