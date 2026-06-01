package com.torn.util;

public class CommonUtil {
    /**
     * 获取当前项目 resources 在代码中的路径，不是 target
     */
    public static String getResourcePath() {
        return System.getProperty("user.dir") + "/torn-city/src/main/resources/";
    }
}
