"""
IDME 服务简单测试
测试查询：Al-Si 合金体系，屈服强度 >= 100MPa
"""
import sys
sys.path.insert(0, '.')

from app.services.idme_service import query_idme_api

print("=" * 60)
print("IDME API 测试 - Al-Si-Mg 体系")
print("=" * 60)

# 查询 Al-Si-Mg 体系
result = query_idme_api.invoke({"material_system": "Al-Si-Mg"})

if "error" in result:
    print(f"❌ 查询失败: {result['error']}")
else:
    data = result.get("data", [])
    print(f"✓ 查询成功，共 {len(data)} 条数据\n")
    
    # 筛选屈服强度 >= 100 MPa 的合金
    print("符合条件的合金 (屈服强度 >= 100 MPa):")
    print("-" * 60)
    
    qualified = []
    for item in data:
        ys = item.get("Property_YieldStrength")
        if ys is not None and ys >= 100:
            qualified.append(item)
            name = item.get("Composition_NAME", "未知")
            uts = item.get("Property_UltimateTensileStrength", "N/A")
            elong = item.get("Property_Elongation", "N/A")
            print(f"  {name}")
            print(f"    屈服强度: {ys} MPa")
            print(f"    抗拉强度: {uts} MPa")
            print(f"    延伸率: {elong} %")
            print()
    
    print(f"\n符合条件: {len(qualified)}/{len(data)} 条")
