/**
 * Performance Monitoring Script
 * Monitors system performance during load tests
 */

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

class PerformanceMonitor {
  constructor(options = {}) {
    this.options = {
      interval: options.interval || 5000, // 5 seconds
      outputDir: options.outputDir || 'test-results/performance',
      metrics: options.metrics || ['cpu', 'memory', 'disk', 'network'],
      ...options,
    };

    this.isMonitoring = false;
    this.metrics = [];
    this.startTime = null;
  }

  async start() {
    console.log('🚀 Starting performance monitoring...');
    this.isMonitoring = true;
    this.startTime = Date.now();

    // Create output directory
    await this.ensureOutputDir();

    // Start monitoring loop
    this.monitoringLoop();
  }

  async stop() {
    console.log('🛑 Stopping performance monitoring...');
    this.isMonitoring = false;

    // Generate report
    await this.generateReport();
  }

  async ensureOutputDir() {
    const dir = this.options.outputDir;
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  async monitoringLoop() {
    while (this.isMonitoring) {
      try {
        const metrics = await this.collectMetrics();
        this.metrics.push({
          timestamp: Date.now(),
          ...metrics,
        });

        // Log current metrics
        console.log(
          `📊 CPU: ${metrics.cpu}%, Memory: ${metrics.memory}%, Disk: ${metrics.disk}%`,
        );
      } catch (error) {
        console.error('Error collecting metrics:', error);
      }

      await this.sleep(this.options.interval);
    }
  }

  async collectMetrics() {
    const metrics = {};

    for (const metric of this.options.metrics) {
      switch (metric) {
        case 'cpu':
          metrics.cpu = await this.getCPUUsage();
          break;
        case 'memory':
          metrics.memory = await this.getMemoryUsage();
          break;
        case 'disk':
          metrics.disk = await this.getDiskUsage();
          break;
        case 'network':
          metrics.network = await this.getNetworkUsage();
          break;
      }
    }

    return metrics;
  }

  async getCPUUsage() {
    try {
      const { stdout } = await execAsync(
        'top -l 1 | grep \'CPU usage\' | awk \'{print $3}\' | sed \'s/%//\'',
      );
      return parseFloat(stdout.trim()) || 0;
    } catch (error) {
      console.warn('Could not get CPU usage:', error.message);
      return 0;
    }
  }

  async getMemoryUsage() {
    try {
      const { stdout } = await execAsync(
        'top -l 1 | grep \'PhysMem\' | awk \'{print $2}\' | sed \'s/M//\'',
      );
      const used = parseFloat(stdout.trim()) || 0;

      // Get total __memory
      const { stdout: totalStdout } = await execAsync(
        'sysctl hw.memsize | awk \'{print $2}\'',
      );
      const total = parseFloat(totalStdout.trim()) / (1024 * 1024) || 1; // Convert to MB

      return Math.round((used / total) * 100);
    } catch (error) {
      console.warn('Could not get __memory usage:', error.message);
      return 0;
    }
  }

  async getDiskUsage() {
    try {
      const { stdout } = await execAsync(
        'df -h / | tail -1 | awk \'{print $5}\' | sed \'s/%//\'',
      );
      return parseFloat(stdout.trim()) || 0;
    } catch (error) {
      console.warn('Could not get disk usage:', error.message);
      return 0;
    }
  }

  async getNetworkUsage() {
    try {
      // Get network statistics
      const { stdout } = await execAsync(
        'netstat -i | grep -E \'^en0|^wlan0\' | awk \'{print $7, $10}\'',
      );
      const parts = stdout.trim().split(' ');
      const bytesIn = parseInt(parts[0]) || 0;
      const bytesOut = parseInt(parts[1]) || 0;

      return {
        bytesIn,
        bytesOut,
        total: bytesIn + bytesOut,
      };
    } catch (error) {
      console.warn('Could not get network usage:', error.message);
      return { bytesIn: 0, bytesOut: 0, total: 0 };
    }
  }

  async generateReport() {
    if (this.metrics.length === 0) {
      console.log('No metrics collected');
      return;
    }

    const report = {
      summary: this.generateSummary(),
      metrics: this.metrics,
      charts: this.generateCharts(),
      recommendations: this.generateRecommendations(),
    };

    // Save report
    const reportPath = path.join(
      this.options.outputDir,
      'performance-report.json',
    );
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

    // Generate HTML report
    await this.generateHTMLReport(report);

    console.log(`📊 Performance report generated: ${reportPath}`);
  }

  generateSummary() {
    const duration = Date.now() - this.startTime;
    const avgCpu =
      this.metrics.reduce((sum, m) => sum + m.cpu, 0) / this.metrics.length;
    const avgMemory =
      this.metrics.reduce((sum, m) => sum + m.memory, 0) / this.metrics.length;
    const avgDisk =
      this.metrics.reduce((sum, m) => sum + m.disk, 0) / this.metrics.length;

    const maxCpu = Math.max(...this.metrics.map((m) => m.cpu));
    const maxMemory = Math.max(...this.metrics.map((m) => m.memory));
    const maxDisk = Math.max(...this.metrics.map((m) => m.disk));

    return {
      duration: Math.round(duration / 1000), // seconds
      dataPoints: this.metrics.length,
      averages: {
        cpu: Math.round(avgCpu * 100) / 100,
        memory: Math.round(avgMemory * 100) / 100,
        disk: Math.round(avgDisk * 100) / 100,
      },
      peaks: {
        cpu: maxCpu,
        memory: maxMemory,
        disk: maxDisk,
      },
    };
  }

  generateCharts() {
    return {
      cpu: this.metrics.map((m) => ({ x: m.timestamp, y: m.cpu })),
      memory: this.metrics.map((m) => ({ x: m.timestamp, y: m.memory })),
      disk: this.metrics.map((m) => ({ x: m.timestamp, y: m.disk })),
    };
  }

  generateRecommendations() {
    const summary = this.generateSummary();
    const recommendations = [];

    if (summary.averages.cpu > 80) {
      recommendations.push({
        type: 'warning',
        message:
          'High CPU usage detected. Consider optimizing code or scaling horizontally.',
      });
    }

    if (summary.averages.memory > 80) {
      recommendations.push({
        type: 'warning',
        message:
          'High __memory usage detected. Consider __memory optimization or increasing available __memory.',
      });
    }

    if (summary.averages.disk > 90) {
      recommendations.push({
        type: 'critical',
        message:
          'Disk space is critically low. Free up disk space immediately.',
      });
    }

    if (summary.peaks.cpu > 95) {
      recommendations.push({
        type: 'critical',
        message: 'CPU usage peaked above 95%. System may be overloaded.',
      });
    }

    if (recommendations.length === 0) {
      recommendations.push({
        type: 'success',
        message: 'System performance is within acceptable limits.',
      });
    }

    return recommendations;
  }

  async generateHTMLReport(report) {
    const html = `
<!DOCTYPE html>
<html>
<head>
    <title>Performance Report</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .summary { background: #f5f5f5; padding: 20px; border-radius: 5px; margin-bottom: 20px; }
        .recommendations { margin-top: 20px; }
        .recommendation { padding: 10px; margin: 5px 0; border-radius: 3px; }
        .warning { background: #fff3cd; border: 1px solid #ffeaa7; }
        .critical { background: #f8d7da; border: 1px solid #f5c6cb; }
        .success { background: #d4edda; border: 1px solid #c3e6cb; }
        .chart-container { width: 100%; height: 400px; margin: 20px 0; }
    </style>
</head>
<body>
    <h1>Performance Report</h1>
    
    <div class="summary">
        <h2>Summary</h2>
        <p><strong>Duration:</strong> ${report.summary.duration} seconds</p>
        <p><strong>Data Points:</strong> ${report.summary.dataPoints}</p>
        
        <h3>Average Usage</h3>
        <ul>
            <li>CPU: ${report.summary.averages.cpu}%</li>
            <li>Memory: ${report.summary.averages.memory}%</li>
            <li>Disk: ${report.summary.averages.disk}%</li>
        </ul>
        
        <h3>Peak Usage</h3>
        <ul>
            <li>CPU: ${report.summary.peaks.cpu}%</li>
            <li>Memory: ${report.summary.peaks.memory}%</li>
            <li>Disk: ${report.summary.peaks.disk}%</li>
        </ul>
    </div>
    
    <div class="chart-container">
        <canvas id="performanceChart"></canvas>
    </div>
    
    <div class="recommendations">
        <h2>Recommendations</h2>
        ${report.recommendations
    .map(
      (rec) =>
        `<div class="recommendation ${rec.type}">${rec.message}</div>`,
    )
    .join('')}
    </div>
    
    <script>
        const ctx = document.getElementById('performanceChart').getContext('2d');
        const chart = new Chart(ctx, {
            type: 'line',
            data: {
                datasets: [
                    {
                        label: 'CPU Usage (%)',
                        data: ${JSON.stringify(report.charts.cpu)},
                        borderColor: 'rgb(255, 99, 132)',
                        backgroundColor: 'rgba(255, 99, 132, 0.2)',
                        yAxisID: 'y'
                    },
                    {
                        label: 'Memory Usage (%)',
                        data: ${JSON.stringify(report.charts.memory)},
                        borderColor: 'rgb(54, 162, 235)',
                        backgroundColor: 'rgba(54, 162, 235, 0.2)',
                        yAxisID: 'y'
                    },
                    {
                        label: 'Disk Usage (%)',
                        data: ${JSON.stringify(report.charts.disk)},
                        borderColor: 'rgb(255, 205, 86)',
                        backgroundColor: 'rgba(255, 205, 86, 0.2)',
                        yAxisID: 'y'
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: {
                        type: 'time',
                        time: {
                            displayFormats: {
                                second: 'HH:mm:ss'
                            }
                        }
                    },
                    y: {
                        type: 'linear',
                        display: true,
                        position: 'left',
                        min: 0,
                        max: 100
                    }
                }
            }
        });
    </script>
</body>
</html>`;

    const htmlPath = path.join(
      this.options.outputDir,
      'performance-report.html',
    );
    fs.writeFileSync(htmlPath, html);
  }

  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

module.exports = PerformanceMonitor;

// CLI usage
if (require.main === module) {
  const monitor = new PerformanceMonitor();

  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    await monitor.stop();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    await monitor.stop();
    process.exit(0);
  });

  // Start monitoring
  monitor.start();
}
