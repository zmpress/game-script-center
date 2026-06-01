package com.torn.model;

import lombok.Data;

import java.math.BigDecimal;

/**
 * OC系数配置表
 *
 * @author Bai
 * @version 0.5.0
 * @since 2025.11.01
 */
@Data
public class TornSettingOcCoefficientDO {
    /**
     * ID
     */
    private Long id;
    /**
     * 帮派ID
     */
    private Long factionId;
    /**
     * OC名称
     */
    private String ocName;
    /**
     * OC级别
     */
    private Integer rank;
    /**
     * 岗位编码
     */
    private String slotCode;
    /**
     * 成功率下限（包含）
     */
    private Integer passRateMin;
    /**
     * 成功率上限（包含）
     */
    private Integer passRateMax;
    /**
     * 工时系数
     */
    private BigDecimal coefficient;
}