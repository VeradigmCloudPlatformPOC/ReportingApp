#!/bin/bash
# sql-vm-inventory.sh
# Query all SQL Server VMs with accurate CPU core counts
# Uses Azure Resource Graph + Compute API
#
# Prerequisites: 
#   - Azure CLI installed and logged in (az login)
#   - jq installed (brew install jq / apt install jq)
#
# Usage: ./sql-vm-inventory.sh [--subscription <sub-id>] [--output json|table|csv]

set -e

# Parse arguments
SUBSCRIPTION_FILTER=""
OUTPUT_FORMAT="table"

while [[ $# -gt 0 ]]; do
    case $1 in
        -s|--subscription)
            SUBSCRIPTION_FILTER="$2"
            shift 2
            ;;
        -o|--output)
            OUTPUT_FORMAT="$2"
            shift 2
            ;;
        -h|--help)
            echo "Usage: $0 [--subscription <sub-id>] [--output json|table|csv]"
            echo ""
            echo "Options:"
            echo "  -s, --subscription  Filter by subscription ID"
            echo "  -o, --output        Output format: json, table, csv (default: table)"
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

# Check prerequisites
if ! command -v az &> /dev/null; then
    echo "Error: Azure CLI (az) is not installed. Install from https://docs.microsoft.com/en-us/cli/azure/install-azure-cli"
    exit 1
fi

if ! command -v jq &> /dev/null; then
    echo "Error: jq is not installed. Install with: brew install jq (macOS) or apt install jq (Linux)"
    exit 1
fi

# Verify Azure login
if ! az account show &> /dev/null; then
    echo "Error: Not logged in to Azure. Run 'az login' first."
    exit 1
fi

echo "=== SQL Server VM Inventory ===" >&2
echo "" >&2

# Build subscription filter for Resource Graph
SUB_PARAM=""
if [ -n "$SUBSCRIPTION_FILTER" ]; then
    SUB_PARAM="--subscriptions $SUBSCRIPTION_FILTER"
    echo "Filtering by subscription: $SUBSCRIPTION_FILTER" >&2
fi

# Query SQL VMs from Resource Graph
echo "Querying SQL VMs from Azure Resource Graph..." >&2

QUERY='
Resources
| where type =~ "microsoft.compute/virtualmachines"
| extend imageReference = properties.storageProfile.imageReference
| extend publisher = tostring(imageReference.publisher)
| extend offer = tostring(imageReference.offer)
| extend imageSku = tostring(imageReference.sku)
| extend imageVersion = tostring(imageReference.version)
| where publisher contains "MicrosoftSQLServer" 
    or offer contains "sql" 
    or imageSku contains "sql"
| extend vmSize = tostring(properties.hardwareProfile.vmSize)
| extend powerState = tostring(properties.extended.instanceView.powerState.displayStatus)
| extend osType = tostring(properties.storageProfile.osDisk.osType)
| project 
    vmName = name,
    vmSize,
    location,
    powerState,
    osType,
    publisher,
    offer,
    imageSku,
    imageVersion,
    resourceGroup,
    subscriptionId
| order by subscriptionId, vmName
'

SQL_VMS=$(az graph query -q "$QUERY" --first 1000 $SUB_PARAM -o json 2>/dev/null | jq '.data // .') 

VM_COUNT=$(echo "$SQL_VMS" | jq 'length')
echo "Found $VM_COUNT SQL VMs" >&2

if [ "$VM_COUNT" -eq 0 ]; then
    echo "No SQL VMs found."
    exit 0
fi

# Get unique location/subscription combinations
echo "Fetching VM size specifications for CPU cores..." >&2

declare -A SIZE_CACHE

# Process each unique location/subscription pair
LOCATIONS_SUBS=$(echo "$SQL_VMS" | jq -r '.[] | "\(.subscriptionId)|\(.location)"' | sort -u)

for LOC_SUB in $LOCATIONS_SUBS; do
    SUB_ID=$(echo "$LOC_SUB" | cut -d'|' -f1)
    LOCATION=$(echo "$LOC_SUB" | cut -d'|' -f2)
    
    echo "  Fetching VM sizes for $LOCATION..." >&2
    
    # Get VM sizes for this location
    SIZES=$(az vm list-sizes --location "$LOCATION" --subscription "$SUB_ID" -o json 2>/dev/null || echo "[]")
    
    # Store in cache
    while IFS= read -r size_info; do
        SIZE_NAME=$(echo "$size_info" | jq -r '.name')
        CORES=$(echo "$size_info" | jq -r '.numberOfCores')
        MEMORY_MB=$(echo "$size_info" | jq -r '.memoryInMB')
        MAX_DISKS=$(echo "$size_info" | jq -r '.maxDataDiskCount')
        SIZE_CACHE["$SIZE_NAME"]="$CORES|$MEMORY_MB|$MAX_DISKS"
    done < <(echo "$SIZES" | jq -c '.[]')
done

echo "" >&2

# Function to extract SQL version from offer/sku
extract_sql_version() {
    local offer="$1"
    local sku="$2"
    local combined="${offer} ${sku}"
    
    if [[ "$combined" =~ [Ss][Qq][Ll]([0-9]{4}) ]]; then
        echo "SQL ${BASH_REMATCH[1]}"
    elif [[ "$combined" =~ ([0-9]{4})-[Ww][Ss] ]]; then
        echo "SQL ${BASH_REMATCH[1]}"
    else
        echo "SQL Server"
    fi
}

# Function to extract SQL edition from offer/sku  
extract_sql_edition() {
    local offer="$1"
    local sku="$2"
    local combined=$(echo "${offer} ${sku}" | tr '[:upper:]' '[:lower:]')
    
    if [[ "$combined" == *"enterprise"* ]]; then
        echo "Enterprise"
    elif [[ "$combined" == *"standard"* ]]; then
        echo "Standard"
    elif [[ "$combined" == *"web"* ]]; then
        echo "Web"
    elif [[ "$combined" == *"developer"* ]] || [[ "$combined" == *"dev"* ]]; then
        echo "Developer"
    elif [[ "$combined" == *"express"* ]]; then
        echo "Express"
    else
        echo "Unknown"
    fi
}

# Build enriched output
TOTAL_CORES=0
TOTAL_RUNNING_CORES=0
ENRICHED_VMS="[]"

while IFS= read -r vm; do
    VM_NAME=$(echo "$vm" | jq -r '.vmName')
    VM_SIZE=$(echo "$vm" | jq -r '.vmSize')
    LOCATION=$(echo "$vm" | jq -r '.location')
    POWER_STATE=$(echo "$vm" | jq -r '.powerState')
    OS_TYPE=$(echo "$vm" | jq -r '.osType')
    PUBLISHER=$(echo "$vm" | jq -r '.publisher')
    OFFER=$(echo "$vm" | jq -r '.offer')
    IMAGE_SKU=$(echo "$vm" | jq -r '.imageSku')
    RG=$(echo "$vm" | jq -r '.resourceGroup')
    SUB_ID=$(echo "$vm" | jq -r '.subscriptionId')
    
    # Get size details from cache
    SIZE_INFO="${SIZE_CACHE[$VM_SIZE]}"
    if [ -n "$SIZE_INFO" ]; then
        CORES=$(echo "$SIZE_INFO" | cut -d'|' -f1)
        MEMORY_MB=$(echo "$SIZE_INFO" | cut -d'|' -f2)
        MAX_DISKS=$(echo "$SIZE_INFO" | cut -d'|' -f3)
        MEMORY_GB=$((MEMORY_MB / 1024))
    else
        CORES="N/A"
        MEMORY_GB="N/A"
        MAX_DISKS="N/A"
    fi
    
    # Extract SQL metadata
    SQL_VERSION=$(extract_sql_version "$OFFER" "$IMAGE_SKU")
    SQL_EDITION=$(extract_sql_edition "$OFFER" "$IMAGE_SKU")
    
    # Update totals
    if [ "$CORES" != "N/A" ]; then
        TOTAL_CORES=$((TOTAL_CORES + CORES))
        if [[ "$POWER_STATE" == *"running"* ]]; then
            TOTAL_RUNNING_CORES=$((TOTAL_RUNNING_CORES + CORES))
        fi
    fi
    
    # Build enriched VM object
    ENRICHED_VM=$(jq -n \
        --arg vmName "$VM_NAME" \
        --arg vmSize "$VM_SIZE" \
        --arg location "$LOCATION" \
        --arg powerState "$POWER_STATE" \
        --arg cores "$CORES" \
        --arg memoryGB "$MEMORY_GB" \
        --arg maxDisks "$MAX_DISKS" \
        --arg sqlVersion "$SQL_VERSION" \
        --arg sqlEdition "$SQL_EDITION" \
        --arg publisher "$PUBLISHER" \
        --arg offer "$OFFER" \
        --arg imageSku "$IMAGE_SKU" \
        --arg resourceGroup "$RG" \
        --arg subscriptionId "$SUB_ID" \
        '{
            vmName: $vmName,
            vmSize: $vmSize,
            location: $location,
            powerState: $powerState,
            cpuCores: (if $cores == "N/A" then null else ($cores | tonumber) end),
            memoryGB: (if $memoryGB == "N/A" then null else ($memoryGB | tonumber) end),
            maxDataDisks: (if $maxDisks == "N/A" then null else ($maxDisks | tonumber) end),
            sqlVersion: $sqlVersion,
            sqlEdition: $sqlEdition,
            publisher: $publisher,
            offer: $offer,
            imageSku: $imageSku,
            resourceGroup: $resourceGroup,
            subscriptionId: $subscriptionId
        }')
    
    ENRICHED_VMS=$(echo "$ENRICHED_VMS" | jq --argjson vm "$ENRICHED_VM" '. + [$vm]')
    
done < <(echo "$SQL_VMS" | jq -c '.[]')

# Output based on format
case $OUTPUT_FORMAT in
    json)
        jq -n \
            --argjson vms "$ENRICHED_VMS" \
            --arg totalVMs "$VM_COUNT" \
            --arg totalCores "$TOTAL_CORES" \
            --arg runningCores "$TOTAL_RUNNING_CORES" \
            --arg timestamp "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" \
            '{
                sqlVMs: $vms,
                summary: {
                    totalVMs: ($totalVMs | tonumber),
                    totalCpuCores: ($totalCores | tonumber),
                    runningCpuCores: ($runningCores | tonumber)
                },
                queriedAt: $timestamp
            }'
        ;;
    csv)
        echo "vmName,vmSize,location,powerState,cpuCores,memoryGB,sqlVersion,sqlEdition,resourceGroup,subscriptionId"
        echo "$ENRICHED_VMS" | jq -r '.[] | [.vmName, .vmSize, .location, .powerState, .cpuCores, .memoryGB, .sqlVersion, .sqlEdition, .resourceGroup, .subscriptionId] | @csv'
        ;;
    table|*)
        echo "=== SQL Server VMs with CPU Cores ==="
        echo ""
        printf "%-28s %-22s %-12s %-6s %-8s %-12s %-12s\n" "VM Name" "VM Size" "Location" "Cores" "Mem GB" "SQL Version" "Edition"
        printf "%-28s %-22s %-12s %-6s %-8s %-12s %-12s\n" "-------" "-------" "--------" "-----" "------" "-----------" "-------"
        
        echo "$ENRICHED_VMS" | jq -r '.[] | [.vmName, .vmSize, .location, (.cpuCores // "N/A" | tostring), (.memoryGB // "N/A" | tostring), .sqlVersion, .sqlEdition] | @tsv' | \
        while IFS=$'\t' read -r name size loc cores mem ver edition; do
            printf "%-28s %-22s %-12s %-6s %-8s %-12s %-12s\n" "$name" "$size" "$loc" "$cores" "$mem" "$ver" "$edition"
        done
        
        echo ""
        echo "=== Summary ==="
        echo "Total SQL VMs:        $VM_COUNT"
        echo "Total CPU Cores:      $TOTAL_CORES"
        echo "Running CPU Cores:    $TOTAL_RUNNING_CORES"
        ;;
esac
