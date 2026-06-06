package com.torn.tool;

import cn.hutool.core.io.FileUtil;
import cn.hutool.core.io.file.FileReader;
import cn.hutool.core.io.file.FileWriter;
import com.torn.util.CommonUtil;

import java.io.File;
import java.util.List;

/**
 * 脚本更新到CDN
 */
public class ScriptUpdateToCDN {

    /**
     * 把src/main/resources/tampermonkey-scripts下的文件完全复制覆盖到src/main/resources/cdn/tampermonkey-scripts下
     * 按行遍历，把里面的https://raw.githubusercontent.com/zmpress/game-script-center/refs/heads/main/torn-city/src/main/resources/tampermonkey-scripts/
     * 全部替换为https://cdn.jsdelivr.net/gh/zmpress/game-script-center@main/torn-city/src/main/resources/cdn/tampermonkey-scripts
     * 用hutool或者jdk自带的工具类
     */
    public static void main(String[] args) {
        updateScriptsToCDN();
    }

    public static void updateScriptsToCDN() {
        try {
            // 获取源目录和目标目录路径
            String sourceDir = CommonUtil.getResourcePath() + "tampermonkey-scripts";
            String targetDir = CommonUtil.getResourcePath() + "cdn/tampermonkey-scripts";
            
            // 确保目标目录存在
            FileUtil.mkdir(targetDir);
            
            // 获取源目录下所有文件
            List<File> sourceFiles = FileUtil.loopFiles(sourceDir);
            
            System.out.println("开始更新脚本到CDN目录...");
            System.out.println("源目录: " + sourceDir);
            System.out.println("目标目录: " + targetDir);
            
            int processedCount = 0;
            for (File sourceFile : sourceFiles) {
                // 只处理文件，跳过目录
                if (!sourceFile.isFile()) {
                    continue;
                }
                
                // 计算相对路径
                String relativePath = sourceFile.getAbsolutePath().substring(sourceDir.length());
                File targetFile = new File(targetDir + relativePath);
                
                // 确保目标文件的父目录存在
                FileUtil.mkdir(targetFile.getParentFile());
                
                // 读取源文件内容
                FileReader reader = new FileReader(sourceFile);
                String content = reader.readString();
                
                // 替换URL
                String oldUrl = "https://raw.githubusercontent.com/zmpress/game-script-center/refs/heads/main/torn-city/src/main/resources/tampermonkey-scripts/";
                String newUrl = "https://cdn.jsdelivr.net/gh/zmpress/game-script-center@main/torn-city/src/main/resources/cdn/tampermonkey-scripts/";
                String updatedContent = content.replace(oldUrl, newUrl);
                
                // 写入目标文件
                FileWriter writer = new FileWriter(targetFile);
                writer.write(updatedContent);
                
                processedCount++;
                System.out.println("已处理: " + sourceFile.getName());
            }
            
            System.out.println("脚本更新完成！共处理 " + processedCount + " 个文件。");
        } catch (Exception e) {
            System.err.println("更新脚本时发生错误: " + e.getMessage());
            e.printStackTrace();
        }
    }

}
