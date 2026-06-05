package com.torn.tool;

import cn.hutool.core.io.FileUtil;
import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONArray;
import com.alibaba.fastjson.JSONObject;
import com.torn.model.TornSettingOcCoefficientDO;
import com.torn.util.CommonUtil;
import com.torn.util.DBUtil;

import java.math.BigDecimal;
import java.util.*;
import java.util.stream.Collectors;

/**
 * 大锅饭系数更新
 */
public class OCWeightUpdate {

    public static void main(String[] args) throws Exception {
        List<TornSettingOcCoefficientDO> tornSettingOcCoefficientDOS =
                DBUtil.queryList(TornSettingOcCoefficientDO.class, "select * from torn_setting_oc_coefficient");

        // 根据 TornSettingOcCoefficientDO里的factionId 转 map
        Map<Long, List<TornSettingOcCoefficientDO>> map = tornSettingOcCoefficientDOS.stream()
                .collect(Collectors.groupingBy(TornSettingOcCoefficientDO::getFactionId));

        for (Map.Entry<Long, List<TornSettingOcCoefficientDO>> entry : map.entrySet()) {
            Long factionId = entry.getKey();
            if (0 == factionId) {
                factionId = 20465L;
            }

            List<TornSettingOcCoefficientDO> allList = entry.getValue();

            // allList 转换格式
            JSONObject resultJson = convertToWeightFormat(allList);

            // 将结果转成 美化后的json
            String json = JSON.toJSONString(resultJson);

            String path = CommonUtil.getResourcePath() + "config/dahuofan-weight/" + factionId + ".json";

            System.out.println("OCWeightUpdate写入文件：" + path);
            FileUtil.writeUtf8String(json, path);
        }
    }

    /**
     * 将 List<TornSettingOcCoefficientDO> 转换成 示例.json 的格式
     * 结构: { "OC名称": { "rank": { "slotCode": [ [min, max, coefficient], ... ] } } }
     *
     * @param coefficientList OC系数列表
     * @return 转换后的JSON对象
     */
    public static JSONObject convertToWeightFormat(List<TornSettingOcCoefficientDO> coefficientList) {
        JSONObject result = new JSONObject(true); // 使用LinkedHashMap保持顺序

        if (coefficientList == null || coefficientList.isEmpty()) {
            return result;
        }

        // 按 ocName 分组，并保持插入顺序
        Map<String, List<TornSettingOcCoefficientDO>> groupedByOcName = coefficientList.stream()
                .collect(Collectors.groupingBy(
                        TornSettingOcCoefficientDO::getOcName,
                        LinkedHashMap::new,
                        Collectors.toList()
                ));

        for (Map.Entry<String, List<TornSettingOcCoefficientDO>> ocEntry : groupedByOcName.entrySet()) {
            String ocName = ocEntry.getKey();
            // 去除岗位名称中的所有空格
            String processedOcName = ocName.replaceAll("\\s+", "");
            List<TornSettingOcCoefficientDO> ocList = ocEntry.getValue();

            // 按 rank 分组，并使用TreeMap排序
            Map<Integer, List<TornSettingOcCoefficientDO>> groupedByRank = ocList.stream()
                    .collect(Collectors.groupingBy(
                            TornSettingOcCoefficientDO::getRank,
                            TreeMap::new,
                            Collectors.toList()
                    ));

            JSONObject rankMap = new JSONObject(true);
            for (Map.Entry<Integer, List<TornSettingOcCoefficientDO>> rankEntry : groupedByRank.entrySet()) {
                Integer rank = rankEntry.getKey();
                List<TornSettingOcCoefficientDO> rankList = rankEntry.getValue();

                // 按 slotCode 分组（保留 #1, #2 等后缀），并保持顺序
                Map<String, List<TornSettingOcCoefficientDO>> groupedBySlot = rankList.stream()
                        .collect(Collectors.groupingBy(
                                TornSettingOcCoefficientDO::getSlotCode,
                                TreeMap::new,
                                Collectors.toList()
                        ));

                // 判断哪些基础岗位有多个变体（如 Muscle#1, Muscle#2）
                Set<String> baseSlotsWithMultipleVariants = findBaseSlotsWithMultipleVariants(groupedBySlot);

                JSONObject slotMap = new JSONObject(true);
                for (Map.Entry<String, List<TornSettingOcCoefficientDO>> slotEntry : groupedBySlot.entrySet()) {
                    String slotCode = slotEntry.getKey();
                    // 去除岗位编码中的所有空格
                    String processedSlotCode = slotCode.replaceAll("\\s+", "");
                    List<TornSettingOcCoefficientDO> slotList = slotEntry.getValue();

                    // 标准化 slotCode：如果该基础岗位只有一个变体，则去掉 #1；否则保留后缀
                    String normalizedSlotCode = normalizeSlotCode(processedSlotCode, baseSlotsWithMultipleVariants);

                    // 按 passRateMin 排序并构建数组 [[min, max, coefficient], ...]
                    JSONArray coefficientArrays = new JSONArray();
                    slotList.stream()
                            .sorted(Comparator.comparingInt(TornSettingOcCoefficientDO::getPassRateMin))
                            .forEach(item -> {
                                JSONArray array = new JSONArray();
                                array.add(item.getPassRateMin());
                                array.add(item.getPassRateMax());
                                // 保留三位小数
                                BigDecimal coefficient = item.getCoefficient().setScale(3, BigDecimal.ROUND_HALF_UP);
                                array.add(coefficient.doubleValue());
                                coefficientArrays.add(array);
                            });

                    slotMap.put(normalizedSlotCode, coefficientArrays);
                }

                rankMap.put(String.valueOf(rank), slotMap);
            }

            result.put(processedOcName, rankMap);
        }

        return result;
    }

    /**
     * 找出有多个变体的基础岗位名称
     * 例如：如果有 Muscle#1, Muscle#2, Muscle#3，则返回包含 "Muscle" 的集合
     *
     * @param groupedBySlot 按 slotCode 分组的数据
     * @return 有多个变体的基础岗位名称集合
     */
    private static Set<String> findBaseSlotsWithMultipleVariants(Map<String, List<TornSettingOcCoefficientDO>> groupedBySlot) {
        Map<String, Integer> baseSlotCount = new HashMap<>();
        
        for (String slotCode : groupedBySlot.keySet()) {
            String baseSlot = extractBaseSlotName(slotCode);
            baseSlotCount.merge(baseSlot, 1, Integer::sum);
        }
        
        // 返回出现次数大于1的基础岗位名称
        Set<String> multipleVariants = new HashSet<>();
        for (Map.Entry<String, Integer> entry : baseSlotCount.entrySet()) {
            if (entry.getValue() > 1) {
                multipleVariants.add(entry.getKey());
            }
        }
        
        return multipleVariants;
    }

    /**
     * 提取基础岗位名称（去掉 #数字 后缀）
     * 例如：Muscle#1 -> Muscle, Bomber#2 -> Bomber
     *
     * @param slotCode 原始岗位编码
     * @return 基础岗位名称
     */
    private static String extractBaseSlotName(String slotCode) {
        if (slotCode == null || slotCode.isEmpty()) {
            return slotCode;
        }
        int hashIndex = slotCode.indexOf('#');
        return hashIndex > 0 ? slotCode.substring(0, hashIndex) : slotCode;
    }

    /**
     * 标准化 slotCode
     * - 如果该基础岗位有多个变体（如 Muscle#1, Muscle#2），保留后缀
     * - 如果该基础岗位只有一个变体（如 Bomber#1），去掉 #1 后缀
     *
     * @param slotCode 原始岗位编码
     * @param multipleVariantSlots 有多个变体的基础岗位名称集合
     * @return 标准化后的岗位编码
     */
    private static String normalizeSlotCode(String slotCode, Set<String> multipleVariantSlots) {
        if (slotCode == null || slotCode.isEmpty()) {
            return slotCode;
        }
        
        String baseSlot = extractBaseSlotName(slotCode);
        
        // 如果该基础岗位有多个变体，保留完整后缀
        if (multipleVariantSlots.contains(baseSlot)) {
            return slotCode;
        }
        
        // 否则只返回基础名称（去掉 #1 等后缀）
        return baseSlot;
    }

}
