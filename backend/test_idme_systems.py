"""
测试 IDME 数据库是否支持多种合金体系的查询。

运行方式：
    conda run -n agent python test_idme_systems.py
"""

import sys
import os

# 将 backend 目录加入路径
sys.path.insert(0, os.path.dirname(__file__))

from app.infra.idme_service import IdmeService

# 待测试的合金体系列表
TEST_SYSTEMS = [
    "Al-Si-Mg",       # 基准：已知体系
    "Al-Si",          # 二元铝硅
    "Al-Cu-Mg",       # 航空铝合金体系
    "Al-Zn-Mg",       # 7 系高强铝合金
    "Al-Zn-Mg-Cu",    # 7075 类
    "Al-Mg-Si",       # 6 系（换序写法）
    "Al-Cu",          # 二元铝铜
    "Al-Mg",          # 5 系
    "Ti-Al",          # 非铝合金（期望返回空数据）
    "Fe-C",           # 钢铁体系（期望返回空数据）
]


def test_system(service: IdmeService, system: str) -> dict:
    """查询单个体系，返回摘要结果"""
    result = service.query(material_system=system, page_size=5, page_number=1)

    if "error" in result:
        return {"system": system, "status": "[ERROR]", "count": 0, "detail": result["error"]}

    data = result.get("data", [])
    count = len(data)

    if count > 0:
        # 尝试提取第一条记录的关键字段作为示例
        sample = data[0]
        # 取前 3 个字段作预览
        preview_keys = list(sample.keys())[:3]
        preview = {k: sample[k] for k in preview_keys}
        return {"system": system, "status": "[OK]   ", "count": count, "sample": preview}
    else:
        return {"system": system, "status": "[EMPTY]", "count": 0, "raw_keys": list(result.keys())}


def main():
    print("=" * 60)
    print("IDME 多合金体系查询测试")
    print("=" * 60)

    service = IdmeService()

    results = []
    for system in TEST_SYSTEMS:
        print(f"\n正在查询: {system} ...")
        res = test_system(service, system)
        results.append(res)

        status = res["status"]
        count = res["count"]
        print(f"  {status}  记录数: {count}")
        if "sample" in res:
            print(f"  示例字段: {res['sample']}")
        if "detail" in res:
            print(f"  错误详情: {res['detail']}")
        if "raw_keys" in res:
            print(f"  响应字段: {res['raw_keys']}")

    # 汇总
    print("\n" + "=" * 60)
    print("汇总结果")
    print("=" * 60)
    print(f"{'合金体系':<20} {'状态':<15} {'记录数'}")
    print("-" * 50)
    for r in results:
        print(f"{r['system']:<20} {r['status']:<15} {r['count']}")

    has_data = [r for r in results if r["count"] > 0]
    no_data  = [r for r in results if r["count"] == 0 and "detail" not in r]
    errors   = [r for r in results if "detail" in r]

    print(f"\n有数据体系 ({len(has_data)}): {[r['system'] for r in has_data]}")
    print(f"空结果体系 ({len(no_data)}): {[r['system'] for r in no_data]}")
    if errors:
        print(f"查询失败   ({len(errors)}): {[r['system'] for r in errors]}")


if __name__ == "__main__":
    main()
