return function()

    ------------------------------------------------------------
    -- Helper: XML escape
    ------------------------------------------------------------
    local function esc(s)
        s = tostring(s or "")
        s = s:gsub("&", "&amp;")
        s = s:gsub("<", "&lt;")
        s = s:gsub(">", "&gt;")
        s = s:gsub('"', "&quot;")
        s = s:gsub("'", "&apos;")
        return s
    end

    ------------------------------------------------------------
    -- 1) Prepare output file:
    --    ...\grandMA3\gma3_library\export\ParameterListExport.xml
    ------------------------------------------------------------
    local basePath  = GetPath(Enums.PathType.Library)
    local sep       = GetPathSeparator()
    local exportDir = basePath .. sep .. "export"

    -- make sure export dir exists (no-op if present)
    os.execute(string.format('mkdir "%s"', exportDir))

    local filePath = exportDir .. sep .. "ParameterListExport.xml"
    local file, err = io.open(filePath, "w")
    if not file then
        ErrPrintf("Could not open file for writing: " .. tostring(err))
        return
    end

    file:write("<ParameterListExport>\n")

    ------------------------------------------------------------
    -- 2) Loop all subfixtures and their RTChannel handles
    ------------------------------------------------------------
    local subCount = GetSubfixtureCount()
    if not subCount or subCount <= 0 then
        ErrPrintf("No subfixtures found")
        file:write("</ParameterListExport>\n")
        file:close()
        return
    end

    for sfIndex = 1, subCount do
        local sf = GetSubfixture(sfIndex)
        if sf ~= nil then
            -- base fixture name from subfixture
            local sfName = sf.Name or "Univ"

            -- get RTChannel HANDLES for this subfixture
            local rtHandles = GetRTChannels(sf, true)
            if rtHandles ~= nil then
                for _, h in ipairs(rtHandles) do
                    ------------------------------------------------
                    -- 2a) Read Coarse DMX string (e.g. "1.001")
                    ------------------------------------------------
                    local coarseStr = h.COARSE
                    if coarseStr ~= nil and coarseStr ~= "" and coarseStr ~= "-" then
                        local uStr, chStr = string.match(coarseStr, "^(%d+)%.(%d+)$")
                        if uStr ~= nil and chStr ~= nil then
                            local universe  = tonumber(uStr) or 0
                            local number    = tonumber(chStr) or 0

                            ------------------------------------------------
                            -- 2b) Look up RTChannel table for names
                            ------------------------------------------------
                            local name        = ""
                            local fixtureName = sfName

                            local rtIndex = h.INDEX
                            local rtInfo  = nil
                            if rtIndex ~= nil then
                                rtInfo = GetRTChannel(rtIndex)
                            end

                            if rtInfo ~= nil then
                                -- attribute/parameter name
                                if rtInfo.ui_index_first ~= nil then
                                    local attr = GetAttributeByUIChannel(rtInfo.ui_index_first)
                                    if attr ~= nil and attr.Name ~= nil then
                                        name = attr.Name
                                    end
                                end

                                if (name == nil or name == "") and
                                   rtInfo.dmx_channel ~= nil and
                                   rtInfo.dmx_channel.Name ~= nil then
                                    name = rtInfo.dmx_channel.Name
                                end

                                -- fixture name from RT info if present
                                if rtInfo.fixture ~= nil and
                                   rtInfo.fixture.Name ~= nil and
                                   rtInfo.fixture.Name ~= "" then
                                    fixtureName = rtInfo.fixture.Name
                                end
                            end

                            ------------------------------------------------
                            -- 2c) Write XML line
                            ------------------------------------------------
                            file:write(string.format(
                                '  <Parameter universe="%s" number="%s" name="%s" fixture="%s"/>\n',
                                esc(universe),
                                esc(number),
                                esc(name),
                                esc(fixtureName)
                            ))
                        end
                    end
                end
            end
        end
    end

    file:write("</ParameterListExport>\n")
    file:close()

    Printf("Parameter List exported to: " .. filePath)
end