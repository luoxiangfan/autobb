import { beforeEach, describe, expect, it, vi } from "vitest";

const createFeishuClientMock = vi.hoisted(() => vi.fn());

vi.mock("./client.js", () => ({
  createFeishuClient: createFeishuClientMock,
}));

import { registerFeishuBitableTools } from "./bitable.js";

describe("feishu_bitable tool extensions", () => {
  const appCreateMock = vi.hoisted(() => vi.fn());
  const appTableListMock = vi.hoisted(() => vi.fn());
  const fieldListMock = vi.hoisted(() => vi.fn());
  const fieldUpdateMock = vi.hoisted(() => vi.fn());
  const fieldDeleteMock = vi.hoisted(() => vi.fn());
  const fieldCreateMock = vi.hoisted(() => vi.fn());
  const recordListMock = vi.hoisted(() => vi.fn());
  const recordBatchDeleteMock = vi.hoisted(() => vi.fn());
  const recordDeleteMock = vi.hoisted(() => vi.fn());

  beforeEach(() => {
    vi.clearAllMocks();

    appCreateMock.mockResolvedValue({
      code: 0,
      data: {
        app: {
          app_token: "app_1",
          name: "Leads",
          url: "https://example.test/base/app_1",
        },
      },
    });
    appTableListMock.mockResolvedValue({
      code: 0,
      data: {
        items: [{ table_id: "tbl_1", name: "Table1" }],
      },
    });
    fieldListMock.mockResolvedValue({
      code: 0,
      data: {
        items: [
          { field_id: "fld_primary", is_primary: true, type: 1, field_name: "Name" },
          { field_id: "fld_default", is_primary: false, type: 3, field_name: "SingleSelect" },
        ],
      },
    });
    fieldUpdateMock.mockResolvedValue({ code: 0 });
    fieldDeleteMock.mockResolvedValue({ code: 0 });
    fieldCreateMock.mockResolvedValue({
      code: 0,
      data: { field: { field_id: "fld_new", field_name: "Status", type: 3 } },
    });
    recordListMock.mockResolvedValue({
      code: 0,
      data: {
        items: [{ record_id: "rec_empty", fields: {} }],
      },
    });
    recordBatchDeleteMock.mockResolvedValue({ code: 0 });
    recordDeleteMock.mockResolvedValue({ code: 0 });

    createFeishuClientMock.mockReturnValue({
      bitable: {
        app: {
          create: appCreateMock,
        },
        appTable: {
          list: appTableListMock,
        },
        appTableField: {
          list: fieldListMock,
          update: fieldUpdateMock,
          delete: fieldDeleteMock,
          create: fieldCreateMock,
        },
        appTableRecord: {
          list: recordListMock,
          batchDelete: recordBatchDeleteMock,
          delete: recordDeleteMock,
        },
      },
      wiki: {
        space: {
          getNode: vi.fn(),
        },
      },
    });
  });

  it("registers create_app/create_field tools and runs create_app cleanup", async () => {
    const registerTool = vi.fn();
    registerFeishuBitableTools({
      config: {
        channels: {
          feishu: {
            appId: "app_id",
            appSecret: "app_secret",
          },
        },
      } as any,
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() } as any,
      registerTool,
    } as any);

    const names = registerTool.mock.calls.map((call) => call[0]?.name);
    expect(names).toContain("feishu_bitable_create_app");
    expect(names).toContain("feishu_bitable_create_field");

    const createAppTool = registerTool.mock.calls
      .map((call) => call[0])
      .find((tool) => tool.name === "feishu_bitable_create_app");
    const result = await createAppTool.execute("tool-call", { name: "Leads" });

    expect(appCreateMock).toHaveBeenCalledOnce();
    expect(fieldUpdateMock).toHaveBeenCalledOnce();
    expect(fieldDeleteMock).toHaveBeenCalledOnce();
    expect(recordBatchDeleteMock).toHaveBeenCalledOnce();
    expect(result.details.app_token).toBe("app_1");
    expect(result.details.table_id).toBe("tbl_1");
    expect(result.details.cleaned_default_fields).toBe(2);
    expect(result.details.cleaned_placeholder_rows).toBe(1);
  });

  it("creates bitable field via feishu_bitable_create_field", async () => {
    const registerTool = vi.fn();
    registerFeishuBitableTools({
      config: {
        channels: {
          feishu: {
            appId: "app_id",
            appSecret: "app_secret",
          },
        },
      } as any,
      logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() } as any,
      registerTool,
    } as any);

    const createFieldTool = registerTool.mock.calls
      .map((call) => call[0])
      .find((tool) => tool.name === "feishu_bitable_create_field");

    const result = await createFieldTool.execute("tool-call", {
      app_token: "app_1",
      table_id: "tbl_1",
      field_name: "Status",
      field_type: 3,
    });

    expect(fieldCreateMock).toHaveBeenCalledOnce();
    expect(result.details.field_id).toBe("fld_new");
    expect(result.details.type_name).toBe("SingleSelect");
  });
});
