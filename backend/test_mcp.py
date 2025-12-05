"""
测试 MCP 服务器连接和工具参数
"""
import asyncio
import json
from langchain_mcp_adapters.client import MultiServerMCPClient

async def test_mcp():
    """测试 MCP 连接并打印工具参数结构"""
    config = {
        "calphadmesh-mcp": {
            "transport": "streamable_http",
            "url": "http://111.22.21.99:10004/mcp",
            "headers": {
                "Authorization": "Bearer tk_9EERZLMf3jVd7BqlL2x1VeswUZMOS5We"
            }
        }
    }
    
    print("正在连接 MCP 服务器...")
    client = MultiServerMCPClient(config)
    
    # 需要查看的工具
    target_tools = [
        "onnx_model_inference",
        "onnx_get_model_config",
        "onnx_get_models_info",
        "calphamesh_submit_scheil_task",
        "calphamesh_submit_point_task",
    ]
    
    try:
        tools = await client.get_tools()
        print(f"成功! 获取到 {len(tools)} 个工具\n")
        
        for tool in tools:
            if tool.name in target_tools:
                print(f"=" * 60)
                print(f"工具名称: {tool.name}")
                print(f"描述: {tool.description}")
                print(f"参数结构 (args_schema):")
                if hasattr(tool, 'args_schema') and tool.args_schema:
                    schema = tool.args_schema
                    if hasattr(schema, 'schema'):
                        schema = schema.schema()
                    print(json.dumps(schema, indent=2, ensure_ascii=False))
                else:
                    print("  无 schema 信息")
                print()
        # 测试获取模型配置
        print("\n" + "=" * 60)
        print("测试调用 onnx_get_model_config (AlSiMg_properties_v1):")
        model_uuid = "9fa6d60e-55ea-4035-96f2-6f9cfa1a9696"
        for tool in tools:
            if tool.name == "onnx_get_model_config":
                result = await tool.ainvoke({"uuid": model_uuid})
                print(f"模型配置:\n{result}")
                break
                
    except Exception as e:
        import traceback
        print(f"错误: {e}")
        traceback.print_exc()

if __name__ == "__main__":
    asyncio.run(test_mcp())
